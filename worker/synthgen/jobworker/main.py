"""Generation job poller.

Polls "GenerationJob" with SELECT ... FOR UPDATE SKIP LOCKED to claim work atomically.
Concurrency = N coroutines pulling from the same pool. No Redis, no Celery — Postgres
already holds all our state, so it's the integration bus too.
"""
from __future__ import annotations

import asyncio
import logging
import signal
import sys
from typing import Optional

from .. import db
from ..benchmarks.runner import execute_benchmark_run
from ..config import get_settings
from ..generation import execute_job


log = logging.getLogger("synthgen.worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


_shutdown = asyncio.Event()


def _install_signal_handlers(loop: asyncio.AbstractEventLoop) -> None:
    def handler(signum: int, _frame=None) -> None:
        log.info("received signal %s — draining", signum)
        _shutdown.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, handler, sig)
        except NotImplementedError:
            signal.signal(sig, handler)


async def _claim_job() -> Optional[str]:
    """Atomically claim one pending job from a non-cancelled run."""
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                WITH next AS (
                    SELECT j.id
                    FROM "GenerationJob" j
                    JOIN "GenerationRun" r ON r.id = j."runId"
                    WHERE j.status = 'pending'
                      AND r.status IN ('queued', 'running')
                    ORDER BY j."createdAt" ASC
                    FOR UPDATE OF j SKIP LOCKED
                    LIMIT 1
                )
                UPDATE "GenerationJob" SET status = 'running', "updatedAt" = NOW()
                WHERE id = (SELECT id FROM next)
                RETURNING id
                """
            )
            return row["id"] if row else None


async def _mark_run_started(run_id: str) -> None:
    await db.execute(
        """UPDATE "GenerationRun" SET status = 'running',
           "startedAt" = COALESCE("startedAt", NOW()), "updatedAt" = NOW()
           WHERE id = $1 AND status = 'queued'""",
        run_id,
    )


async def _maybe_complete_run(run_id: str) -> None:
    # Include 'queued' too — regenerate sets job rows to queued and the fire-
    # and-forget path bypasses the poller, so without this we'd prematurely
    # mark a run completed while queued jobs are still waiting to fire.
    pending = await db.fetch_one(
        """SELECT COUNT(*)::int AS n FROM "GenerationJob"
           WHERE "runId" = $1 AND status IN ('pending', 'queued', 'running')""",
        run_id,
    )
    if pending and pending["n"] == 0:
        await db.execute(
            """UPDATE "GenerationRun" SET status = 'completed',
               "completedAt" = NOW(), "updatedAt" = NOW()
               WHERE id = $1 AND status IN ('running', 'queued')""",
            run_id,
        )


async def _process_one() -> bool:
    job_id = await _claim_job()
    if not job_id:
        return False

    job = await db.fetch_one(
        """SELECT "runId" FROM "GenerationJob" WHERE id = $1""", job_id
    )
    if not job:
        return False

    await _mark_run_started(job["runId"])

    try:
        await execute_job(job_id)
    except Exception:  # noqa: BLE001
        log.exception("job %s crashed", job_id)
    finally:
        await _maybe_complete_run(job["runId"])
    return True


async def _consumer(name: str, idle_sleep: float) -> None:
    log.info("consumer %s starting", name)
    while not _shutdown.is_set():
        try:
            did_work = await _process_one()
        except Exception:  # noqa: BLE001
            log.exception("consumer loop error")
            did_work = False
        if not did_work:
            try:
                await asyncio.wait_for(_shutdown.wait(), timeout=idle_sleep)
            except asyncio.TimeoutError:
                pass
    log.info("consumer %s stopped", name)


# ─── Benchmark runs ──────────────────────────────────────────────────────────
#
# BenchmarkRun rows in status='queued' are claimed by a separate consumer
# pool. A run is one long-lived asyncio task (potentially hours for 100k
# items), so the pool runs at low concurrency (1-2 simultaneous runs is
# usually enough — within each run the worker already parallelises items
# via samplingParams.concurrency). Same SKIP LOCKED pattern as the
# generation-job claimer so multiple worker containers don't double-pick.


async def _claim_benchmark_run() -> Optional[str]:
    """Atomically claim one queued BenchmarkRun. Returns its id or None."""
    async with db.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                WITH next AS (
                    SELECT id FROM "BenchmarkRun"
                    WHERE status = 'queued'
                    ORDER BY "createdAt" ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE "BenchmarkRun" SET status = 'running',
                    "startedAt" = COALESCE("startedAt", NOW()),
                    "updatedAt" = NOW()
                WHERE id = (SELECT id FROM next)
                RETURNING id
                """,
            )
            return row["id"] if row else None


async def _process_one_benchmark() -> bool:
    run_id = await _claim_benchmark_run()
    if not run_id:
        return False
    log.info("benchmark run %s claimed — executing", run_id)
    try:
        await execute_benchmark_run(run_id)
    except Exception:  # noqa: BLE001
        log.exception("benchmark run %s crashed", run_id)
        # Best-effort flip back to failed so the row doesn't sit at
        # 'running' forever after a crash. The run itself usually sets
        # this in its own try/except, but a hard crash here means we
        # might not get there.
        try:
            await db.execute(
                """UPDATE "BenchmarkRun" SET status = 'failed',
                   "lastError" = COALESCE("lastError", 'worker crashed'),
                   "completedAt" = NOW(),
                   "updatedAt" = NOW()
                   WHERE id = $1 AND status = 'running'""",
                run_id,
            )
        except Exception:  # noqa: BLE001
            pass
    return True


async def _benchmark_consumer(name: str, idle_sleep: float) -> None:
    log.info("benchmark consumer %s starting", name)
    while not _shutdown.is_set():
        try:
            did_work = await _process_one_benchmark()
        except Exception:  # noqa: BLE001
            log.exception("benchmark consumer loop error")
            did_work = False
        if not did_work:
            try:
                # Idle a bit longer than the generation poller — a few
                # seconds extra delay on benchmark pickup is fine.
                await asyncio.wait_for(_shutdown.wait(), timeout=idle_sleep * 2)
            except asyncio.TimeoutError:
                pass
    log.info("benchmark consumer %s stopped", name)


async def main_async() -> None:
    settings = get_settings()
    await db.get_pool()
    loop = asyncio.get_running_loop()
    _install_signal_handlers(loop)

    consumers = [
        asyncio.create_task(_consumer(f"c{i}", settings.worker_poll_interval_seconds))
        for i in range(max(1, settings.worker_concurrency))
    ]
    # Benchmark runs: low-concurrency pool (default 2). Each run handles
    # its own internal item-level parallelism via samplingParams.
    # concurrency, so we don't need many simultaneous runs.
    bench_concurrency = max(1, getattr(settings, "benchmark_worker_concurrency", 2))
    benchmark_consumers = [
        asyncio.create_task(
            _benchmark_consumer(f"b{i}", settings.worker_poll_interval_seconds)
        )
        for i in range(bench_concurrency)
    ]
    try:
        await asyncio.gather(*consumers, *benchmark_consumers)
    finally:
        await db.close_pool()


def run() -> None:
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    run()
