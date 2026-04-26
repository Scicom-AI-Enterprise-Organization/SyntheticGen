# SyntheticGen

Enterprise-grade synthetic dataset generator for LLM fine-tuning, with first-class
support for **Malaysian languages and registers** — Bahasa Melayu, English, Mandarin,
Tamil, code-switching (Bahasa Rojak), and a hard-enforced **formality lock** for
enterprise customers (TM, banks, government) that need formal Bahasa Baku output
with **no Manglish particles** (`lah / lor / meh / kan / kot / wei / doh / eh`).

Built on top of an enterprise Next.js 16 + Auth.js v5 + Prisma + Postgres template,
with a Python (FastAPI + asyncpg) science backend that owns LLM provider calls,
validators, generation, and exports.

## What it does

- **Multilingual generation** — single-turn samples (multi-turn coming next slice) in
  Bahasa Melayu, English, Mandarin, Tamil, with first-class code-switching policy
  (none / inter-sentential / intra-sentential / rojak) and configurable rate.
- **Formality enforcement** — every project ships with two seeded `LanguageProfile`
  presets:
  - **Malaysia – Enterprise Formal (TM-style)** — formal Bahasa Baku, particle ban,
    SMS-shortcut rejection, English loanwords restricted to a telco-domain allowlist
    (`router`, `bil`, `bandwidth`, …).
  - **Malaysia – Casual (Manglish OK)** — full Bahasa Rojak with intra-sentential
    code-switching enabled.
- **Layered formality precedence** — Run > Persona > LanguageProfile > Project default.
  The Run wizard exposes a "Formality lock" toggle that overrides everything below it.
- **Cheap-first validator pipeline** — JSON-Schema → lingua-py language ID →
  register-compliance (Manglish particle / Bahasa Baku / loanword policy) → n-gram
  repetition. Anything `fail` → conversation marked `rejected`.
- **OpenAI-compatible providers** — one client serves OpenAI, vLLM, Together,
  OpenRouter, SGLang, Anthropic-via-proxy. API keys AES-256-GCM encrypted at rest;
  decrypted only inside the Python worker.
- **Project-scoped RBAC** — `OWNER / EDITOR / ANNOTATOR / VIEWER` per project, on top
  of the existing global Auth.js permissions.
- **Dataset versioning** — frozen `DatasetVersion` snapshots are immutable, with
  full lineage (which conversations, from which run, with which judge verdicts).
- **OpenAI fine-tune JSONL export** — one click per version. ShareGPT / Alpaca /
  Parquet / HF Hub push planned for slice 2.
- **Audit log** — every project / provider / run / dataset action persisted.

## Architecture

Two processes share Postgres as the integration bus:

```
 ┌────────────────────┐        ┌──────────────────────┐        ┌──────────────┐
 │ Next.js (TS)       │        │ Postgres (Prisma)    │        │ Python       │
 │  - Auth.js + RBAC  │ writes │  - Project, Persona  │  reads │  - providers │
 │  - all CRUD UI     │ ─────▶│  - LanguageProfile   │◀───── │  - validators│
 │  - run wizard      │        │  - GenerationRun/Job │  writes│  - worker    │
 │  - SSE progress    │ reads  │  - Conversation/Msg  │ ─────▶│  - exporter  │
 │  - dataset freeze  │ ◀───── │  - Validation        │        │  - FastAPI   │
 └────────────────────┘        └──────────────────────┘        └──────────────┘
                                       ▲
                                       │ NOTIFY synthgen_run
                                       │ (live progress)
```

The Python service exposes only **internal endpoints** that Next.js calls
service-to-service (gated by a shared `SYNTHGEN_INTERNAL_TOKEN`).

## Repo layout

```
prisma/                Schema + migrations + seed (TS)
src/                   Next.js app (TS)
  app/(app)/projects/  All project-scoped pages
  app/api/             SSE + JSON APIs Next.js calls
  lib/
    rbac.ts            Global RBAC (template)
    project-rbac.ts    Project-scoped role → action map
    crypto.ts          AES-256-GCM matching the Python wire format
    audit.ts           Audit log helper
    synthgen-api.ts    Thin client for the Python service
worker/                Python service
  synthgen/
    presets.py         Manglish particles, Baku shortcuts, loanword allowlists
    style_guide.py     Auto-injected formality system-prompt fragment
    templates.py       Mustache renderer
    providers.py       httpx OpenAI-compat client + pricing table
    validators/        schema, lang_id (lingua-py), register, ngram
    generation.py      Single-turn generation pipeline
    exporter.py        OpenAI JSONL writer
    bootstrap.py       Seed default LanguageProfile presets per project
    api/main.py        FastAPI internal endpoints
    jobworker/main.py  Job poller (SELECT ... FOR UPDATE SKIP LOCKED)
    crypto.py          AES-256-GCM matching the TS wire format
  tests/               smoke_e2e.py + smoke_export.py + stub_openai.py
storage/exports/       Built export artifacts (local FS in slice 1)
```

## Quickstart

Prereqs: Node 20+, npm, Python 3.11+ (3.13 recommended), [uv](https://docs.astral.sh/uv/),
Docker (or your own Postgres).

```bash
git clone <your-fork-url> syntheticgen
cd syntheticgen
cp .env.example .env
# Generate secrets
sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 32)|" .env
sed -i "s|^APP_ENCRYPTION_KEY=.*|APP_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
sed -i "s|^SYNTHGEN_INTERNAL_TOKEN=.*|SYNTHGEN_INTERNAL_TOKEN=$(openssl rand -hex 24)|" .env
```

### 1. Postgres + migrations + seed

```bash
docker compose up -d db
npm install
npm run db:migrate      # applies prisma/migrations/*
npm run db:seed         # creates roles, permissions, admin user
```

Default admin: `admin@example.com / admin1234` (override with
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`).

### 2. Python worker

```bash
cd worker
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -e .
cd ..
```

### 3. Run all three processes

In **three terminals** (or use `tmux` / `Procfile`):

```bash
# Terminal 1 — Python FastAPI service (internal endpoints + run/export triggers)
env $(grep -v '^#' .env | xargs) \
  worker/.venv/bin/uvicorn synthgen.api.main:app --port 8000

# Terminal 2 — Python job worker (LLM calls + validators)
env $(grep -v '^#' .env | xargs) \
  worker/.venv/bin/python -m synthgen.jobworker.main

# Terminal 3 — Next.js dev server
npm run dev
```

Open http://localhost:3000 and sign in. Click **Projects → New project**.
The two Malaysia LanguageProfile presets are seeded automatically by the Python
worker on project creation; if the worker is offline you'll get a soft warning
and can re-seed via **Settings → Reseed default language profiles**.

## End-to-end happy path

1. **Create project** — click *New project*. Two LanguageProfile presets appear under
   the Languages tab (formal + casual).
2. **Add a Persona** under *Personas* — at minimum a name. The form warns if the
   persona's formality clashes with the chosen LanguageProfile (e.g. persona is
   `colloquial` but profile bans particles).
3. **Add a TaxonomyNode** under *Taxonomy* — slice 1 uses a single flat list per
   project (e.g. `billing`, `modem-troubleshooting`, `plan-upgrade`).
4. **Add a PromptTemplate** under *Templates*. The default body uses
   `{{persona.name}}`, `{{taxonomy.path}}`, `{{language.primary}}`, `{{difficulty}}`.
5. **Add a Provider** under *Providers* — pick OpenAI / vLLM / Together / etc.,
   paste an API key (encrypted before saving).
6. **Start a Run** under *Runs → New run*. Pick taxonomy nodes × personas ×
   difficulties × rows-per-cell. Use the **Formality lock** to force `formal` even if
   personas/profiles are mixed.
7. **Watch progress** — the run detail page subscribes to SSE; counts and cost
   update live as the worker drains jobs.
8. **Inspect Conversations** — table at `/projects/.../conversations`. Click a row
   to see the full transcript and per-axis validation verdicts (`pass / warn / fail`).
9. **Freeze and export** — *Datasets → New dataset → Freeze version → Build OpenAI
   JSONL*. The file lands under `./storage/exports/<projectId>/...jsonl`.

## RBAC model

**Global roles** (Auth.js / template) — `admin`, `member`. Global admin sees and
can act on every project. `member` users can list and create projects.

**Project roles** (per `ProjectMember`):

| Action | OWNER | EDITOR | ANNOTATOR | VIEWER |
|---|:---:|:---:|:---:|:---:|
| `project.read` | ✓ | ✓ | ✓ | ✓ |
| `project.update / delete / members.manage` | ✓ | | | |
| `providers.manage` | ✓ | ✓ | | |
| `taxonomy / personas / languages / tools / templates .write` | ✓ | ✓ | | |
| `runs.execute / runs.cancel` | ✓ | ✓ | | |
| `conversations.annotate` | ✓ | ✓ | ✓ | |
| `datasets.freeze / datasets.export` | ✓ | ✓ | | |

Server-side gate: `requireProjectPermission(projectId, action)` — `src/lib/project-rbac.ts`.

## Why a TS + Python split

- **TS / Next.js** is great at request/response, forms, auth, and shipping a
  cohesive UI. It owns everything user-facing.
- **Python** is where data scientists and AI engineers live. The validators,
  provider client, generation orchestration, judge LLMs (slice 2), and HF Hub /
  Parquet exports are markedly easier to maintain in Python — `lingua-py`,
  `jsonschema`, `httpx`, `sentence-transformers`, `datasets`, and `pyarrow` all
  Just Work.
- They share **Postgres** as the bus; no Redis, no Celery, no Inngest. Workers
  claim jobs atomically with `SELECT ... FOR UPDATE SKIP LOCKED`. State, queue,
  and lineage live in one place.

## The Malaysia formality moat

This is the bit generic synth-data tools don't model. Three layers cooperate:

1. **System-prompt style guide** — `worker/synthgen/style_guide.py` auto-prepends
   instructions like *"Respond in formal Bahasa Melayu Baku. Do not use Manglish
   particles … Use full standard spelling (`tidak` not `tak` …)."* This is cheap
   prevention; it reduces the rate of violations the model produces.
2. **Register-compliance validator** — `worker/synthgen/validators/register.py`.
   Word-bounded, case-insensitive blocklist match for Manglish particles, regex
   blocklist for project-defined patterns, Bahasa Baku enforcement that rejects
   SMS shortcuts (`tak / je / dah / mcm`), allowlist policy for English loanwords.
   Belt-and-braces: catches what the prompt missed.
3. **Per-project tuning** — every field on `LanguageProfile` is editable. Telco
   teams ship with `router / modem / bil / bandwidth` in their loanword allowlist;
   bank teams ship with their own.

## Smoke tests

The `worker/tests/` directory has two end-to-end smokes you can run against a real
local Postgres + the in-repo stub OpenAI server:

```bash
# 1. Start the stub OpenAI on :8765
env $(grep -v '^#' .env | xargs) worker/.venv/bin/python worker/tests/stub_openai.py &
# 2. Start the Python API on :8000 (so bootstrap works)
env $(grep -v '^#' .env | xargs) worker/.venv/bin/uvicorn synthgen.api.main:app --port 8000 &

# 3. Run a project bootstrap, then 2 jobs (clean + Manglish), assert correct verdicts
env $(grep -v '^#' .env | xargs) worker/.venv/bin/python worker/tests/smoke_e2e.py

# 4. Freeze a dataset version and emit OpenAI JSONL
env $(grep -v '^#' .env | xargs) worker/.venv/bin/python worker/tests/smoke_export.py
```

Both expect a smoke project named `smoke-proj-001` (created by the first run).

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5434/enterprise?schema=public` | Postgres for both TS and Python |
| `AUTH_SECRET` | (required) | Auth.js JWT signing |
| `AUTH_URL` | `http://localhost:3000` | App base URL |
| `APP_ENCRYPTION_KEY` | (required) | 32 bytes base64 — encrypts provider API keys |
| `SYNTHGEN_API_URL` | `http://localhost:8000` | Where Next.js finds the Python service |
| `SYNTHGEN_INTERNAL_TOKEN` | (required) | Shared secret for service-to-service calls |
| `EXPORTS_DIR` | `./storage/exports` | Where built export files land |
| `WORKER_POLL_INTERVAL_SECONDS` | `2` | Idle poll interval for the job worker |
| `WORKER_CONCURRENCY` | `4` | Number of in-process consumer coroutines |

## Out of scope for slice 1 (planned)

- Multi-turn conversation generation (architecture supports `parentId`, branching,
  but UI is linear)
- Tool / function calling + mock executor with MyKad / LHDN / Maybank locale presets
- Judge-LLM validators (per-axis rubrics, sampled at e.g. 10%)
- Annotation UI (`/projects/[id]/annotate`)
- Embedding-based dedup (pgvector)
- ShareGPT / Alpaca / Parquet / HF Hub push exporters
- Cost budgets per team
- Adversarial / red-team slice presets
- Diversity dashboards
- Jawi / Tamil-script / Hans generation paths (schema supports them; lang-ID and
  validators currently focus on Latin-script outputs)

## Tech stack

- [Next.js 16](https://nextjs.org) + React 19 + Tailwind v4 + Radix UI
- [Auth.js v5](https://authjs.dev) — credentials, Azure AD, Google, Keycloak, SAML
- [Prisma 6](https://www.prisma.io) + Postgres 14+
- Python 3.11+ + [FastAPI](https://fastapi.tiangolo.com) + [asyncpg](https://magicstack.github.io/asyncpg/)
- [lingua-py](https://github.com/pemistahl/lingua-py) for language detection
- [httpx](https://www.python-httpx.org/) for OpenAI-compat calls
- [cryptography](https://cryptography.io/) for AES-256-GCM (matching Node's `crypto`)

## Default credentials

After `npm run db:seed`:

| Email | Password |
|---|---|
| `admin@example.com` | `admin1234` |

**Change these before deploying anywhere reachable.** Override with
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` before seeding.
