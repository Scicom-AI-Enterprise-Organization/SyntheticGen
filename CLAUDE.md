# Claude guide — SyntheticGen

Synthetic-data-generation platform: define a project (taxonomy × personas × templates),
point it at an **OpenAI-compatible LLM endpoint**, and a worker fans out **generation jobs**
that produce conversations/rows. Next.js UI + a Python worker, Postgres-backed job queue.

## Architecture (where things live)

- **`src/`** — Next.js app (UI + the `/api/v1/...` REST API). Runs on **port 3001** in dev
  (`npm run dev`; `AUTH_URL=http://localhost:3001` in `.env`).
- **`worker/synthgen/`** — the Python backend, run in **Docker** (`docker compose`):
  - `api/main.py` — FastAPI internal API (port **8000**), `X-Internal-Token` auth. The Next API
    calls it (`src/lib/synthgen-api.ts`) to start/cancel/execute runs.
  - `jobworker/main.py` — the **worker poller**: claims `pending` `GenerationJob` rows
    (`FOR UPDATE SKIP LOCKED`) for `queued`/`running` runs, runs `execute_job`, marks the run
    `completed` when all jobs are terminal. Concurrency = `WORKER_CONCURRENCY` (default 4).
  - `generation.py` — the per-job generation loop (loads run/provider/persona/template, calls the LLM).
  - `providers.py` — the **LLM HTTP client**: `chat_completion()` (non-stream) + `chat_completion_stream()`.
    POSTs to **`{provider.baseUrl}/chat/completions`** with `Authorization: Bearer <decrypted key>`,
    body `{model, messages, temperature, top_p, max_tokens?, ...}`. tenacity retry 3× exp-backoff.
- **`prisma/schema.prisma`** — the data model (Postgres via Prisma).
- **`dataset-main/`, `synthetic/`** — supporting data/scripts (not the run path).

## Run model (Prisma)

- **`GenerationRun`**: `status` ∈ `draft|queued|running|paused|completed|failed|cancelled`,
  `model`, `providerCredentialId` (→ the endpoint), `samplingParams`, `gridSpec`
  (`{taxonomyNodeIds, personaIds, rowsPerCell}`), `targetCount`/`producedCount`/`acceptedCount`.
  **No error field** — check the jobs.
- **`GenerationJob`** (one per grid cell): `status` ∈ `pending|running|succeeded|failed|skipped|cancelled`,
  **`lastError`** (the failure message), `attempts`, `inputContext`, `conversationId`.
- **`JobEvent`** — per-job trace timeline (`kind`, `payload`) — the detailed log of one job.
- **`ProviderCredential`** — the LLM endpoint: **`baseUrl`** (OpenAI-compatible base, e.g.
  `…/v1`), `encryptedApiKey` (AES-256-GCM, `APP_ENCRYPTION_KEY`), `kind`, `defaultModel`,
  optional `headers`/`reasoningEffort`/`chatTemplateKwargs`.
- **`Conversation`** — the generated output (`status` `generated|accepted|rejected|…`, `turnCount`).

## Auth / API keys

- API keys are **`sgk_…`**; sent as `Authorization: Bearer sgk_…`. Validated in `src/lib/rbac.ts`
  by `sha256(token)` lookup against `ApiKey.hashedToken`.
- REST: `POST/GET /api/v1/projects/:pid/runs`, `GET /api/v1/projects/:pid/runs/:rid`,
  `.../cancel`, `.../replicate` (re-run = new run from the same config).

## Local dev / debugging

- **Services** (`docker compose ps`): `db` (Postgres **:5434**, db `enterprise`, user/pass
  `postgres`/`postgres`), `synthgen-api` (:8000), `synthgen-worker` (no port). Next.js runs on
  the host (`npm run dev`, :3001). The override bind-mounts `./worker` + hot-reloads (watchfiles).
- **`.env`**: `DATABASE_URL=postgresql://postgres:postgres@localhost:5434/enterprise`,
  `APP_ENCRYPTION_KEY`, `SYNTHGEN_API_URL=http://localhost:8000`, `SYNTHGEN_INTERNAL_TOKEN`,
  `WORKER_CONCURRENCY`.
- **Inspect a run** (the fastest way to see why it failed):
  ```bash
  PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d enterprise -c \
    "SELECT status,count(*) FROM \"GenerationJob\" WHERE \"runId\"='<RUN_ID>' GROUP BY status;"
  PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d enterprise -c \
    "SELECT DISTINCT \"lastError\" FROM \"GenerationJob\" WHERE \"runId\"='<RUN_ID>' AND \"lastError\" IS NOT NULL;"
  # the endpoint a run uses:
  PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d enterprise -c \
    "SELECT p.name,p.\"baseUrl\",r.model FROM \"GenerationRun\" r JOIN \"ProviderCredential\" p ON p.id=r.\"providerCredentialId\" WHERE r.id='<RUN_ID>';"
  ```
- **Re-run a cancelled/failed run** in place: set the run `status='queued'` and its jobs
  `status='pending'`, `lastError=NULL` — the worker re-claims them. (Or use `.../replicate`.)
- **Worker logs**: `docker compose logs -f synthgen-worker`.

## ⚠️ The Docker-`localhost` gotcha (bit us once)

The worker runs **inside a container**, so a provider `baseUrl` of `http://localhost:<port>`
points at the *container*, not the host — symptom: jobs fail with **`All connection attempts
failed`**. To reach a service on the **Docker host** (e.g. a local serverless-GPU gateway):

1. The provider `baseUrl` must use **`http://host.docker.internal:<port>/…`** (not `localhost`).
2. `docker-compose.yml` gives `synthgen-worker`/`synthgen-api`
   **`extra_hosts: ["host.docker.internal:host-gateway"]`** so that name resolves on Linux.
3. The **host service must listen on `0.0.0.0`**, not `127.0.0.1` (else the container gets
   `Connection refused` even though the name resolves).

For the GPU platform at `/home/husein/ssd3/GPUPlatform`: its gateway endpoints are OpenAI-compatible
at `http://<host>:8080/<app_id>/v1` (e.g. `tm-fleet`), keyed by an `sgpu_…` API key. A model that
returns the gateway's `504 "no completion in 60s — cold-starting"` is the GPU model waking — use
`stream:true` or retry; a model reported `dead` (KV-cache OOM) is a GPU-fleet config issue on that
side (max-model-len too large for the available GPU memory), not a SyntheticGen bug.
