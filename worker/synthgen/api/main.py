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
from ..ai_assist import ai_assist, ai_assist_stream
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
    """Used in tests / debugging — normally the worker poller drives jobs."""
    conv_id = await execute_job(job_id)
    return {"ok": True, "conversationId": conv_id}


class AiAssistRequest(BaseModel):
    kind: str  # persona | taxonomy-node | language-profile | prompt-template
    prompt: str
    providerId: str
    model: str | None = None
    extraContext: str | None = None


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
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    return {"ok": True, **result}


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
