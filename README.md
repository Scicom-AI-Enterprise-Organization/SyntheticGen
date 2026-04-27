# SyntheticGen

Enterprise-grade synthetic dataset generator for LLM fine-tuning, with first-class
support for **Malaysian languages and registers** — Bahasa Melayu, English, Mandarin,
Tamil, code-switching (Bahasa Rojak), and a hard-enforced **formality lock** for
enterprise customers (TM, banks, government) that need Formal Malay output
with **no Manglish particles** (`lah / lor / meh / kan / kot / wei / doh / eh`).

Built on top of an enterprise Next.js 16 + Auth.js v5 + Prisma + Postgres template,
with a Python (FastAPI + asyncpg) science backend that owns LLM provider calls,
validators, generation, and exports.

## What it does

- **Multilingual generation** — single-turn samples (multi-turn via Flows) in
  Bahasa Melayu, English, Mandarin, Tamil, with first-class code-switching policy
  (none / inter-sentential / intra-sentential / rojak) and configurable rate.
- **Formality enforcement** — every project ships with two seeded `LanguageProfile`
  presets:
  - **Malaysia – Enterprise Formal (TM-style)** — Formal Malay, particle ban,
    SMS-shortcut rejection, English loanwords restricted to a telco-domain allowlist
    (`router`, `bil`, `bandwidth`, …).
  - **Malaysia – Casual (Manglish OK)** — full Bahasa Rojak with intra-sentential
    code-switching enabled.
- **Layered formality precedence** — Run > Persona > LanguageProfile > Project default.
  The Run wizard exposes a "Formality lock" toggle that overrides everything below it.
- **Cheap-first validator pipeline** — JSON-Schema → lingua-py language ID →
  register-compliance (Manglish particle / Formal Malay / loanword policy) → n-gram
  repetition. Anything `fail` → conversation marked `rejected`.
- **OpenAI-compatible providers** — one client serves OpenAI, vLLM, Together,
  OpenRouter, SGLang, Anthropic-via-proxy. API keys AES-256-GCM encrypted at rest;
  decrypted only inside the Python worker.
- **Tool catalog** — define OpenAI-style function/tool definitions (JSON Schema +
  MY-locale presets like `mykad / lhdn / maybank / tng / duitnow`), referenced by
  Action nodes in flows.
- **Conversation flows** — visual React Flow editor (`/projects/[id]/flows`) lets
  you author DAGs of `intent → action → condition → end` nodes. Action nodes can
  chain **multiple tool calls per turn** (sequential when later calls depend on
  earlier results, parallel for independent fan-out). Generate flows from a plain
  English description, round-trip as YAML.
- **Project-scoped RBAC** — `OWNER / EDITOR / ANNOTATOR / VIEWER` per project, on top
  of the existing global Auth.js permissions.
- **AI-assist on every complex form** — Persona, LanguageProfile, PromptTemplate,
  ToolDef, TaxonomyNode, and full Flow graphs. Click ✨ Fill/Generate, describe in
  free text, the LLM emits structured JSON that auto-fills the form for review.
- **Dashboard with charts** — daily activity, acceptance donut, language mix,
  top projects, validation-fail breakdown — pure-SVG, no chart-lib dependency.
- **Dataset versioning** — frozen `DatasetVersion` snapshots are immutable, with
  full lineage (which conversations, from which run, with which judge verdicts).
- **OpenAI fine-tune JSONL export** — one click per version. ShareGPT / Alpaca /
  Parquet / HF Hub push planned for slice 2.
- **Invite-as-register** — invitation links land on a register form, not a generic
  /login. New users set a password, the invite consumes itself in one shot.
- **Audit log** — every project / provider / run / dataset / flow action persisted.

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
  app/(app)/
    dashboard/         SyntheticGen home with stats + charts
    projects/          All project-scoped pages
      [projectId]/
        personas/      Persona CRUD (with AI-assist)
        languages/     LanguageProfile CRUD (formality lock, banned tokens, …)
        templates/     PromptTemplate CRUD (Mustache renderer + AI-assist)
        tools/         ToolDef CRUD (OpenAI tool schema, locale presets)
        flows/         React Flow editor — author conversation graphs
          [flowId]/    Editor: palette, canvas, inspector, AI-generate, YAML I/O
        taxonomy/      Flat topic list (slice 1)
        providers/     OpenAI-compat provider credentials (AES-256-GCM at rest)
        runs/          Run wizard, list, detail (SSE live progress)
        conversations/ Generated conversations + per-axis verdicts
        datasets/      Datasets / versions / OpenAI JSONL export
  app/api/             SSE + JSON APIs Next.js calls
    projects/[id]/ai-assist/   Single endpoint, kind = persona / taxonomy-node /
                                language-profile / prompt-template / tool-def /
                                flow-graph
  app/invite/[token]/  Invite link → register form
  components/
    ai-assist-button.tsx    Shared dialog used by all complex forms
    charts/                 BarChart / DonutChart / HorizontalBars (SVG)
  lib/
    rbac.ts            Global RBAC (template)
    project-rbac.ts    Project-scoped role → action map
    crypto.ts          AES-256-GCM matching the Python wire format
    audit.ts           Audit log helper
    synthgen-api.ts    Thin client for the Python service (incl. ai-assist kinds)
worker/                Python service
  synthgen/
    presets.py         Manglish particles, Formal-Malay shortcuts, loanword allowlists
    style_guide.py     Auto-injected formality system-prompt fragment
    templates.py       Mustache renderer
    providers.py       httpx OpenAI-compat client + pricing table
    validators/        schema, lang_id (lingua-py), register, ngram
    generation.py      Single-turn generation pipeline
    exporter.py        OpenAI JSONL writer
    bootstrap.py       Seed default LanguageProfile presets per project
    ai_assist.py       Structured-output prompts per kind (persona / flow-graph / …)
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
2. **Add a Provider** under *Providers* first — pick OpenAI / vLLM / Together / etc.,
   paste an API key. Required to use any AI-assist features below.
3. **Add a Persona** under *Personas* — at minimum a name. Use ✨ Fill with AI to
   describe the persona in plain English (e.g. "28-year-old Indian-Malaysian software
   engineer in KL who codeswitches MS↔EN") and have the form auto-fill. The form warns
   if the persona's formality clashes with the chosen LanguageProfile.
4. **Add a TaxonomyNode** under *Taxonomy* — slice 1 uses a single flat list per
   project (e.g. `billing`, `modem-troubleshooting`, `plan-upgrade`). ✨ Suggest
   takes a one-line description.
5. **Add Tools** under *Tools* — OpenAI-style function defs with JSON Schema params
   and locale tags (`mykad / lhdn / maybank / …`). Use ✨ Fill with AI ("a function
   that looks up a Maybank account balance by 12-digit account number") to draft them.
6. **(Optional) Author a Flow** under *Flows* — drag intent / action / condition / end
   nodes onto the canvas, wire them up. Action nodes can chain multiple tool calls per
   turn (sequential / parallel). Or click ✨ Generate from prompt to produce the whole
   graph from a description, review the YAML, and apply.
7. **Add a PromptTemplate** under *Templates*. Uses `{{persona.name}}`, `{{taxonomy.path}}`,
   `{{language.primary}}`, `{{difficulty}}`. ✨ Fill with AI works here too.
8. **Start a Run** under *Runs → New run*. Pick taxonomy nodes × personas ×
   difficulties × rows-per-cell. Use the **Formality lock** to force `formal` even if
   personas/profiles are mixed.
9. **Watch progress** — the run detail page subscribes to SSE; counts and cost
   update live as the worker drains jobs.
10. **Inspect Conversations** — table at `/projects/.../conversations`. Click a row
    to see the full transcript and per-axis validation verdicts (`pass / warn / fail`).
11. **Freeze and export** — *Datasets → New dataset → Freeze version → Build OpenAI
    JSONL*. The file lands under `./storage/exports/<projectId>/...jsonl`.

## Conversation flows

`/projects/[id]/flows` — visual editor for multi-turn conversation graphs.

**Node kinds** (drag from the palette):
- **Start** — entry point (one per flow, auto-created).
- **Intent** — user said something matching `examples`. The worker rewrites one of
  the examples into a user turn.
- **Action** — what the assistant does. Carries `description` plus an optional
  ordered `toolIds` list and a `toolMode` of `sequential` (later calls see earlier
  results) or `parallel` (model emits parallel `tool_calls`). Visual badge shows
  `2 tools →` or `2 tools ∥`.
- **Condition** — branch on a free-text `expression`. Edges out of a Condition
  carry labels like `tool.success` / `tool.not_found` / `yes` / `no`.
- **End** — terminal with `outcome: resolved | escalated | abandoned`.

**Generate from prompt** — a toolbar button opens a dialog: free-text description,
provider picker, the LLM emits the canonical graph (validated against the project's
tool catalog so `action.toolIds` only references real tools). Preview is shown as
YAML; Apply replaces the canvas and runs auto-layout (BFS-layered, left-to-right).

**YAML round-trip** — a separate toolbar dialog with an Export tab (read-only YAML
of the current canvas + Copy) and an Import tab (paste YAML + Apply). The same
coercer used by AI-generate validates pasted YAML — drops invalid nodes, dedupes
IDs, drops dangling edges, filters unknown tool IDs. Positions in the YAML are
preserved if present; otherwise auto-layout runs.

The worker's flow walker (slice 2) consumes these graphs to produce structured
multi-turn conversations: pick a path from Start → End, generate user/assistant
turns guided by each node's data, mock-execute Action nodes' tools.

## AI-assist — structured-output dialog on every complex form

Every form whose schema has more than a couple of fields (Persona, LanguageProfile,
Template, ToolDef, TaxonomyNode, full Flow graphs) gets a ✨ button that opens an
"Fill with AI" dialog. You type a free-text description, pick a Provider, and the
LLM returns structured JSON that the form then auto-fills. You always review and
save — the LLM never touches the database directly.

Implementation:
- TS — `src/components/ai-assist-button.tsx` (single shared dialog) and
  `src/lib/synthgen-api.ts` (typed client + `AiAssistKind` union).
- Python — `worker/synthgen/ai_assist.py` (per-kind structured-output prompts,
  tolerant JSON extractor that strips markdown fences). `flow-graph` kind also
  receives the project's tool catalog as `extraContext` so `action.toolIds` stays
  in-bounds.
- API gate — `src/app/api/projects/[id]/ai-assist` route enforces the
  per-kind RBAC action (`personas.write`, `flows.write`, etc.) before delegating
  to the Python service.

## RBAC model

**Global roles** (Auth.js / template) — `admin`, `member`. Global admin sees and
can act on every project. `member` users can list and create projects.

**Project roles** (per `ProjectMember`):

| Action | OWNER | EDITOR | ANNOTATOR | VIEWER |
|---|:---:|:---:|:---:|:---:|
| `project.read` | ✓ | ✓ | ✓ | ✓ |
| `project.update / delete / members.manage` | ✓ | | | |
| `providers.manage` | ✓ | ✓ | | |
| `taxonomy / personas / languages / tools / templates / flows .write` | ✓ | ✓ | | |
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
   instructions like *"Respond in Formal Malay. Do not use Manglish
   particles … Use full standard spelling (`tidak` not `tak` …)."* This is cheap
   prevention; it reduces the rate of violations the model produces.
2. **Register-compliance validator** — `worker/synthgen/validators/register.py`.
   Word-bounded, case-insensitive blocklist match for Manglish particles, regex
   blocklist for project-defined patterns, Formal Malay enforcement that rejects
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

## Roadmap

**Done**
- Single-turn generation with formality lock + cheap validators
- Tool catalog (CRUD with AI-assist)
- Flow editor (React Flow + AI-generate + YAML round-trip)
- Multi-tool Action nodes (sequential / parallel)
- Project / persona / template / language-profile / taxonomy CRUD with AI-assist
- Dashboard charts
- Invite-as-register flow
- OpenAI fine-tune JSONL export

**Next slice**
- **Worker walks Flow graphs** — pick a path through the published flow, generate
  user/assistant turns turn-by-turn, mock-execute Action nodes' tools to produce
  realistic shaped responses (MyKad / LHDN / Maybank format).
- **Mock tool executor** — generates valid-looking outputs from `mockResponseSchema`
  + `mockSeed` on each ToolDef.
- **Judge-LLM validators** — per-axis rubrics (correctness, naturalness, language
  fidelity, code-switch realism, tool-arg validity), sampled (e.g. 10%) to keep cost
  bounded, calibrated against a human-rated gold set.
- **Annotation UI** at `/projects/[id]/annotate` — accept / reject / edit feeds
  rejected samples into DPO/KTO preference pairs.
- **Embedding-based dedup** (pgvector) — across-conversation deduplication.
- **More exporters** — ShareGPT, Alpaca, Parquet, HF Hub push.
- **Figma / Mermaid import** for flows.
- **Cost budgets per team**, adversarial slice presets, diversity dashboards,
  Jawi / Tamil / Hans generation paths.

## Tech stack

- [Next.js 16](https://nextjs.org) + React 19 + Tailwind v4 + Radix UI
- [Auth.js v5](https://authjs.dev) — credentials, Azure AD, Google, Keycloak, SAML
- [Prisma 6](https://www.prisma.io) + Postgres 14+
- [@xyflow/react](https://reactflow.dev) for the Flow editor
- [js-yaml](https://github.com/nodeca/js-yaml) for YAML round-trip
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
