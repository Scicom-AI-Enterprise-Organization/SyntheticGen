"""FastAPI service for the synthgen Python backend.

Exposes only the internal endpoints Next.js calls. No public endpoints.
"""
from __future__ import annotations

import asyncio
import json as _json
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.responses import StreamingResponse

from pydantic import BaseModel

from .. import db
from ..ai_assist import ai_assist, ai_assist_stream, random_prompt, random_prompt_stream
from ..benchmarks.runner import execute_benchmark_run
from ..bootstrap import bootstrap_project_defaults
from ..config import get_settings
from ..exporter import build_export
from ..generation import execute_job


log = logging.getLogger("synthgen.api")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.get_pool()
    yield
    await db.close_pool()


app = FastAPI(title="SyntheticGen API", version="0.1.0", lifespan=lifespan)


def require_internal(x_internal_token: str = Header(default="")):
    expected = get_settings().synthgen_internal_token
    if not expected or x_internal_token != expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing or invalid internal token")


@app.get("/healthz")
async def healthz():
    return {"ok": True, "service": "synthgen", "version": "0.1.0"}


@app.post("/internal/projects/{project_id}/bootstrap")
async def bootstrap_project(project_id: str, _=Depends(require_internal)):
    created = await bootstrap_project_defaults(project_id)
    return {"created": created}


@app.post("/internal/runs/{run_id}/start")
async def start_run(run_id: str, _=Depends(require_internal)):
    """Mark a queued run as runnable. The poller picks up its jobs from there."""
    result = await db.execute(
        """
        UPDATE "GenerationRun"
        SET status = 'queued', "startedAt" = COALESCE("startedAt", NOW()), "updatedAt" = NOW()
        WHERE id = $1 AND status IN ('draft', 'paused')
        """,
        run_id,
    )
    return {"ok": True, "result": result}


@app.post("/internal/runs/{run_id}/cancel")
async def cancel_run(run_id: str, _=Depends(require_internal)):
    await db.execute(
        """
        UPDATE "GenerationRun"
        SET status = 'cancelled', "completedAt" = NOW(), "updatedAt" = NOW()
        WHERE id = $1 AND status IN ('queued', 'running', 'paused')
        """,
        run_id,
    )
    await db.execute(
        """UPDATE "GenerationJob" SET status = 'skipped', "updatedAt" = NOW()
           WHERE "runId" = $1 AND status = 'pending'""",
        run_id,
    )
    return {"ok": True}


@app.post("/internal/exports/{export_id}/build")
async def build_export_endpoint(export_id: str, _=Depends(require_internal)):
    # Build inline. Slice 1 datasets are small enough this is fine; larger ones
    # would dispatch to the worker queue.
    result = await build_export(export_id)
    return {"ok": True, **result.__dict__}


@app.post("/internal/jobs/{job_id}/execute")
async def execute_job_endpoint(job_id: str, _=Depends(require_internal)):
    """Dispatch a single job for execution as a background task and return
    immediately. Errors during execution get logged + persisted to the
    GenerationJob row (status=failed, lastError) so the UI can surface them
    without a 500 from this endpoint."""
    asyncio.create_task(_run_job_safe(job_id))
    return {"ok": True, "jobId": job_id}


_job_log = logging.getLogger(__name__)


async def _run_job_safe(job_id: str) -> None:
    """Wrapper that catches any exception from execute_job, writes it back to
    the job row, logs it, then checks whether the parent run can now be marked
    completed. Without this, exceptions in `asyncio.create_task` would be
    swallowed by the event loop AND fire-and-forget dispatches (Regenerate,
    Jumpstart) would leave the run stuck in `running` even after every job
    succeeded, because the poller-driven completion check never sees them."""
    # Look up the run id once so we can still flip the run on failure paths.
    run_row = await db.fetch_one(
        'SELECT "runId" FROM "GenerationJob" WHERE id = $1', job_id,
    )
    run_id = run_row["runId"] if run_row else None

    try:
        await execute_job(job_id)
    except Exception as e:  # noqa: BLE001
        _job_log.exception("execute_job failed for %s", job_id)
        try:
            await db.execute(
                """
                UPDATE "GenerationJob"
                SET status = 'failed', "lastError" = $2, "finishedAt" = NOW(), "updatedAt" = NOW()
                WHERE id = $1
                """,
                job_id,
                f"{type(e).__name__}: {e}"[:1000],
            )
        except Exception:  # noqa: BLE001
            _job_log.exception("could not persist failure for job=%s", job_id)

    if run_id:
        try:
            await _maybe_complete_run(run_id)
        except Exception:  # noqa: BLE001
            _job_log.exception("could not finalize run %s after job %s", run_id, job_id)


async def _maybe_complete_run(run_id: str) -> None:
    """If every job in this run is in a terminal state (succeeded / failed /
    cancelled / skipped), flip the run to `completed`. Mirrors the poller's
    completion logic in jobworker/main.py but covers fire-and-forget dispatch
    paths (Regenerate, Jumpstart, /internal/jobs/{id}/execute)."""
    row = await db.fetch_one(
        """SELECT COUNT(*)::int AS n FROM "GenerationJob"
           WHERE "runId" = $1 AND status IN ('pending', 'queued', 'running')""",
        run_id,
    )
    if row and row["n"] == 0:
        await db.execute(
            """UPDATE "GenerationRun" SET status = 'completed',
               "completedAt" = NOW(), "updatedAt" = NOW()
               WHERE id = $1 AND status IN ('running', 'queued')""",
            run_id,
        )


class AiAssistRequest(BaseModel):
    kind: str  # persona | taxonomy-node | language-profile | prompt-template
    prompt: str
    providerId: str
    model: str | None = None
    extraContext: str | None = None
    maxTokens: int | None = None
    temperature: float | None = None


@app.post("/internal/benchmark-runs/{run_id}/start")
async def start_benchmark_run(run_id: str, _=Depends(require_internal)):
    """Kick off a benchmark run as a background task and return immediately.

    The run drives a long-running asyncio task that streams progress into the
    BenchmarkRun row; the UI polls (or subscribes via SSE) to track it.
    """
    asyncio.create_task(execute_benchmark_run(run_id))
    return {"ok": True, "runId": run_id}


@app.post("/internal/ai-assist")
async def ai_assist_endpoint(req: AiAssistRequest, _=Depends(require_internal)):
    try:
        result = await ai_assist(
            kind=req.kind,
            prompt=req.prompt,
            provider_id=req.providerId,
            model=req.model,
            extra_context=req.extraContext,
            max_tokens=req.maxTokens,
            temperature=req.temperature,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    return {"ok": True, **result}


class RandomPromptRequest(BaseModel):
    providerId: str
    description: str
    extraContext: str | None = None
    maxTokens: int | None = None


@app.post("/internal/random-prompt")
async def random_prompt_endpoint(req: RandomPromptRequest, _=Depends(require_internal)):
    try:
        result = await random_prompt(
            provider_id=req.providerId,
            description=req.description,
            extra_context=req.extraContext,
            max_tokens=req.maxTokens or 4000,
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
    return {"ok": True, **result}


@app.post("/internal/random-prompt/stream")
async def random_prompt_stream_endpoint(req: RandomPromptRequest, _=Depends(require_internal)):
    """NDJSON-streamed Randomize. Same event shape as /internal/ai-assist/stream
    plus a final {"type":"done","text":"..."} carrying the cleaned prompt."""

    async def gen():
        try:
            async for event in random_prompt_stream(
                provider_id=req.providerId,
                description=req.description,
                extra_context=req.extraContext,
                max_tokens=req.maxTokens or 4000,
            ):
                yield _json.dumps(event) + "\n"
        except Exception as e:  # noqa: BLE001
            yield _json.dumps({"type": "error", "error": str(e)}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@app.post("/internal/ai-assist/stream")
async def ai_assist_stream_endpoint(req: AiAssistRequest, _=Depends(require_internal)):
    """NDJSON-streamed variant of /internal/ai-assist. Each line is one event."""

    async def gen():
        try:
            async for event in ai_assist_stream(
                kind=req.kind,
                prompt=req.prompt,
                provider_id=req.providerId,
                model=req.model,
                extra_context=req.extraContext,
                max_tokens=req.maxTokens,
                temperature=req.temperature,
            ):
                yield _json.dumps(event) + "\n"
        except Exception as e:  # noqa: BLE001
            yield _json.dumps({"type": "error", "error": str(e)}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "synthgen.api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        log_level="info",
    )
