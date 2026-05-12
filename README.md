# SyntheticGen

Enterprise-grade synthetic dataset generator for LLM fine-tuning, built around
**localized realism** — any locale, any register, any formality regime.

The engine is locale-agnostic: `LanguageProfile` rows carry the language(s),
script, code-switch policy, register, banned tokens, SMS-shortcut blocklist, and
loanword allowlist. The validator + style-guide + worker read those fields; none
of them know what language is involved.

**Malaysia is the flagship**: every project ships with two seeded profiles —
*Enterprise Formal (TM-style)* (Formal Malay, no Manglish particles `lah / lor /
meh / kan / kot / wei / doh / eh`, telco loanword allowlist) and *Casual
(Manglish OK)* (full Bahasa Rojak with intra-sentential code-switching). The
same patterns are how you'd model **French** (`vous` formal vs. `tu` informal,
ban anglicisms, reject SMS shortcuts like `tkt / svp / bcp`), **German**
(`Sie` formal vs. `du` informal, anglicism + `lol/mfg/lg` SMS-shortcut bans),
**Spanish** (`tú/usted/voseo`), **Italian** (`lei/tu`), or any other market —
just by swapping the seeded data.

Built on Next.js 16 + Auth.js v5 + Prisma + Postgres, with a Python
(FastAPI + asyncpg) science backend that owns LLM provider calls, validators,
generation, and exports.

## What it does

- **Multilingual generation** — single-turn samples (multi-turn via Flows) in any
  language; code-switching is first-class (none / inter-sentential /
  intra-sentential / rojak) at a configurable rate. Lang-ID is restricted per
  project to the languages on the LanguageProfile so confidence scores stay sharp.
- **Formality enforcement** — every project ships with two Malaysia-tuned
  seeded `LanguageProfile` presets to demonstrate the pattern:
  - **Malaysia – Enterprise Formal (TM-style)** — Formal Malay, particle ban,
    SMS-shortcut rejection, English loanwords restricted to a telco-domain allowlist
    (`router`, `bil`, `bandwidth`, …).
  - **Malaysia – Casual (Manglish OK)** — full Bahasa Rojak with intra-sentential
    code-switching enabled.

  The same fields model any locale — French formal-`vous` / banned anglicisms /
  banned `tkt`/`svp` shortcuts, German formal-`Sie` / banned `lg`/`mfg`, etc.
  Profile editor lets you author/clone these per project.
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
  Action nodes in flows. The ✨ AI-assist `tool-def` kind also emits 2-4
  **synthetic argument examples** that the worker validates against the tool's
  JSON Schema before saving (invalid ones are dropped with inline warnings).
- **Knowledge base** — per-project `KnowledgeBaseEntry` rows the worker
  auto-injects into the system prompt before each generation. Entries link to
  one-or-many taxonomy nodes (empty list = project-wide); the deterministic
  retrieval is `cardinality(taxonomyNodeIds)=0 OR primary_node = ANY(...)`.
  Authoring options: paste text, **upload PDF / DOCX / HTML / TXT** (extracted
  via `unpdf` / `mammoth` / `html-to-text`), or **crawl a URL** with BFS
  depth-N — pages are streamed live, cached in `KnowledgeCrawl`, and any cached
  crawl can be merged into a single entry from the New entry form. Provider-side
  AI-assist (`knowledge-entry` kind) drafts a clean title, restructures the
  content, and auto-ticks taxonomy nodes from a fixed `AVAILABLE_TAXONOMY` list.
- **Provider reasoning controls** — per-provider `reasoningEffort` (OpenAI
  o-series `minimal | low | medium | high`) and free-form `chatTemplateKwargs`
  (vLLM Qwen3 `{enable_thinking: false}`, etc.) stored on `ProviderCredential`
  and forwarded on every chat call. Setting `enable_thinking` also mirrors to
  top-level `include_reasoning` so vLLM fully suppresses chain-of-thought.
- **Conversation flows** — visual React Flow editor (`/projects/[id]/flows`) lets
  you author DAGs of `intent → action → condition → end` nodes. Action nodes can
  chain **multiple tool calls per turn** (sequential when later calls depend on
  earlier results, parallel for independent fan-out). Generate flows from a plain
  English description, round-trip as YAML.
- **Project-scoped RBAC** — `OWNER / EDITOR / ANNOTATOR / VIEWER` per project, on top
  of the existing global Auth.js permissions.
- **AI-assist on every complex form** — Persona, LanguageProfile, PromptTemplate,
  ToolDef, TaxonomyNode, full Flow graphs, KnowledgeBaseEntry, and benchmark
  rubrics. Click ✨ Fill/Generate, describe in free text; the LLM emits structured
  JSON that auto-fills the form for review. **Streaming-by-default**: the dialog
  shows reasoning + content tokens live (collapsible panel for thinking models),
  with a red **Stop** button that aborts the upstream connection. Each dialog
  has **Use example** (pre-fills a sensible prompt), **Randomize** (asks the
  provider to invent a prompt — also streamed, also abortable), URL-driven
  `?suggest=1` open state, and a **max output tokens** slider so reasoning
  models don't run out of budget mid-answer.
- **Per-job live token preview** — the run detail page picks one running
  `GenerationJob` and streams its tokens (reasoning + content) into a card via
  Postgres `LISTEN synthgen_job`. Reasoning content is persisted on the
  `Message` row for later inspection.
- **Conversation trace tab** — every conversation has a step-by-step
  `JobEvent` timeline: job picked up → context loaded → prompt rendered →
  provider request → reasoning/content stream → validators → persistence. The
  drawer has Messages / Trace tabs (URL-synced), JSON / Trace download buttons,
  and renders the full provenance (run config, template body, persona snapshot,
  language profile, provider, KB entries used). Conversations are also
  filterable by topic / language / status, sortable by turns / tokens / time,
  and paginated.
- **Dashboard with charts** — daily activity, acceptance donut, language mix,
  top projects, validation-fail breakdown — pure-SVG, no chart-lib dependency.
- **Dataset versioning** — frozen `DatasetVersion` snapshots are immutable, with
  full lineage (which conversations, from which run, with which judge verdicts).
- **Multiple export formats** — one click per dataset version:
  - `openai-jsonl` — OpenAI fine-tune format (`{messages: [...]}` per line).
  - `function-call-bench` — Scicom Function-Call benchmark format
    ([repo](https://github.com/Scicom-AI-Enterprise-Organization/small-ablation/tree/main/function-call-benchmark)).
    Each row is `{conversation: "<json>", functions: "<json>", language: "ms|en|zh|…"}`,
    drop-in compatible with the benchmark's `datasets.load_dataset` loader.
  - ShareGPT / Alpaca / Parquet / HF Hub push planned for slice 2.
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
 │  - dataset freeze  │ ◀───── │  - JobEvent timeline │        │  - FastAPI   │
 │  - trace timeline  │        │  - KnowledgeBase     │        │              │
 └────────────────────┘        └──────────────────────┘        └──────────────┘
                                       ▲
                                       │ NOTIFY synthgen_run (job done)
                                       │ NOTIFY synthgen_job  (per-token live stream)
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
        personas/      Persona CRUD (with AI-assist Randomize)
        languages/     LanguageProfile CRUD (formality lock, banned tokens, …)
        templates/     PromptTemplate CRUD (Mustache renderer + AI-assist)
        tools/         ToolDef CRUD (OpenAI schema + synthetic examples)
        knowledge/     KnowledgeBaseEntry CRUD + doc upload + URL crawler card
        flows/         React Flow editor — author conversation graphs
          [flowId]/    Editor: palette, canvas, inspector, AI-generate, YAML I/O
        taxonomy/      Flat topic list (slice 1) with ✨ Suggest (multi)
        providers/     OpenAI-compat provider credentials (AES-256-GCM at rest)
        runs/          Run wizard, list, detail (SSE counts + live job tokens)
        conversations/ Generated conversations + per-axis verdicts + trace tab
        datasets/      Datasets / versions / OpenAI JSONL export
  app/api/             SSE + JSON APIs Next.js calls
    projects/[id]/
      ai-assist/                        Single endpoint, kind = persona /
                                        taxonomy-node / language-profile /
                                        prompt-template / tool-def / flow-graph
                                        / knowledge-entry / benchmark-rubric.
                                        Supports `?stream=1` NDJSON
      random-prompt/                    LLM-generated example prompts (streaming)
      knowledge/extract/                PDF / DOCX / HTML / TXT → text
      knowledge/crawl/                  BFS URL crawl, NDJSON stream, caches
                                        results in KnowledgeCrawl
      runs/[runId]/stream/              SSE run snapshot
      runs/[runId]/jobs/[id]/stream/    LISTEN synthgen_job → per-token SSE
      conversations/[id]/               GET conversation + messages + reasoning
      conversations/[id]/trace/         Full provenance JSON (events + run +
                                        template body + persona + lp + provider
                                        + job). `?download=1` for attachment
  app/invite/[token]/  Invite link → register form
  components/
    ai-assist-button.tsx    Shared streaming dialog (Fill / Use example / Randomize)
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
    templates.py       Mustache renderer (supports {{knowledge}}, {{taxonomy.related}})
    providers.py       httpx OpenAI-compat client — non-streaming + streaming
                       with stream_options.include_usage; per-call reasoning_effort
                       + chat_template_kwargs
    validators/        schema, lang_id (lingua-py), register, ngram
    generation.py      Single-turn pipeline w/ streaming, JobEvent timeline,
                       knowledge-base injection, related-topics
    exporter.py        OpenAI JSONL writer
    bootstrap.py       Seed default LanguageProfile presets per project
    ai_assist.py       Per-kind structured-output prompts + tolerant JSON
                       extractor + jsonschema-based tool-def example verifier
    api/main.py        FastAPI internal endpoints (incl. NDJSON streaming
                       /internal/ai-assist/stream + /internal/random-prompt/stream)
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

#### Or: docker compose (db + api + worker + app together)

```bash
docker compose up --build
```

This brings up four services on one network:

| Service | What | Port |
|---|---|---|
| `db` | Postgres 16 | `5434` (host) → `5432` |
| `synthgen-api` | FastAPI internal endpoints | `8000` |
| `synthgen-worker` | Job poller | — |
| `app` | Next.js (production build) | `3000` |

`AUTH_SECRET`, `APP_ENCRYPTION_KEY`, and `SYNTHGEN_INTERNAL_TOKEN` are read
from your local `.env`. Migrations and the seed still run from the host
against the dockerized db (they expect `5434`):

```bash
npm run db:migrate
npm run db:seed
```

Exports are written to a shared `exports` volume so `app`, `synthgen-api`,
and `synthgen-worker` all see the same `/data/exports`.

For dev mode with hot-reload, skip `app` and run `npm run dev` on the host
while leaving `db` / `synthgen-api` / `synthgen-worker` in compose:

```bash
docker compose up --build -d db synthgen-api synthgen-worker
npm run db:migrate && npm run db:seed && rm -rf .next && npm run dev
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
   Generated tools come with 2-4 synthetic argument examples validated against
   the JSON Schema (shown in a collapsible "Parameters" panel).
5a. **Knowledge base** under *Knowledge* — optional but powerful. Add facts the
    assistant should ground answers in: paste text, **Upload doc** (PDF / DOCX /
    HTML / TXT → extracted text + LLM-drafted title + auto-ticked taxonomy
    nodes), or **Crawl a URL** (BFS depth 0-3, same-origin by default, results
    cached in `KnowledgeCrawl`). Cached crawls can be merged into a single entry
    from the New entry form (page snippets capped per-page + total). The worker
    auto-injects matching entries before each generation and the conversation
    trace shows which entries were loaded.
6. **(Optional) Author a Flow** under *Flows* — drag intent / action / condition / end
   nodes onto the canvas, wire them up. Action nodes can chain multiple tool calls per
   turn (sequential / parallel). Or click ✨ Generate from prompt to produce the whole
   graph from a description, review the YAML, and apply.
7. **Add a PromptTemplate** under *Templates*. Uses `{{persona.name}}`, `{{taxonomy.path}}`,
   `{{language.primary}}`, `{{difficulty}}`. ✨ Fill with AI works here too.
8. **Start a Run** under *Runs → New run*. Pick taxonomy nodes × personas ×
   difficulties × rows-per-cell (select-all checkboxes on each axis). Slide
   **Temperature** + **Max output tokens** to taste, optionally tick **Related
   topics per conversation** to weave in N sibling node names via
   `{{taxonomy.related}}`, and use the **Formality lock** to force `formal` even
   if personas/profiles are mixed. Tool catalog gets a multiselect so the run
   ships only the tools you want.
9. **Watch progress** — the run detail page subscribes to SSE; counts and cost
   update live, and a **Live job preview** card streams reasoning + content
   tokens of one currently-running job.
10. **Inspect Conversations** — table at `/projects/.../conversations`. Filter
    by topic / language / status, sort by turns / tokens / time, paginate 25 at
    a time (state in URL). Click a row to open a drawer with Messages / Trace
    tabs: Messages shows the transcript + collapsible reasoning per turn;
    Trace shows the full step-by-step `JobEvent` timeline (job picked up →
    knowledge loaded → prompt rendered → provider request → reasoning/content
    stream → validators → persisted) plus run/template/persona/provider/job
    panels. JSON / Trace download buttons in the drawer header.
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

## Knowledge base

`/projects/[id]/knowledge` — domain facts the assistant grounds in. Three input
modes feed one schema (`KnowledgeBaseEntry`):

- **Paste / type** — title + markdown content + tags + linked taxonomy nodes.
- **Upload doc** — PDF (`unpdf`), DOCX (`mammoth`), HTML / TXT / MD
  (`html-to-text`). After extraction, if a provider is selected the form chains
  into the `knowledge-entry` AI-assist kind: the LLM drafts a 4-10 word title,
  cleans the content (markdown sections, preserves every fact), and **auto-ticks
  taxonomy nodes** from the project's `AVAILABLE_TAXONOMY` list.
- **URL crawl** — the **URL crawls** card runs a BFS crawl from a start URL up
  to depth N (capped at 3, max 50 pages, same-origin by default). Progress
  streams page-by-page over NDJSON; results persist in `KnowledgeCrawl` so you
  can re-import a different subset later, re-crawl with the same params, or
  delete the cache. Clicking a page in a cached crawl expands its extracted
  text inline so you can verify before importing. **Import crawled pages**
  in the New entry form merges the selected pages into a single entry (snippet
  cap per page + total cap so the form doesn't choke on a multi-MB site).

**Worker injection.** Before every generation `generation.py` runs:

```sql
SELECT id, title, content FROM "KnowledgeBaseEntry"
WHERE "projectId" = $1
  AND (cardinality("taxonomyNodeIds") = 0          -- project-wide catch-alls
    OR $2 = ANY("taxonomyNodeIds"))                -- match primary node
ORDER BY "createdAt" DESC LIMIT 20
```

Matching entries are joined into a `## Knowledge base` markdown block,
appended to the system prompt **and** exposed as `{{knowledge}}` so authored
templates can reference it explicitly. The conversation `JobEvent` timeline
emits a `knowledge.loaded` step with the IDs + titles + content sizes used.

No embeddings, no pgvector — tag-based retrieval is deterministic and fast
enough for the typical KB size (hundreds of entries). The retrieval seam is
isolated; swap in semantic search later without changing the template / worker
contract.

## AI-assist — structured-output dialog on every complex form

Every form whose schema has more than a couple of fields (Persona, LanguageProfile,
Template, ToolDef, TaxonomyNode, KnowledgeBaseEntry, full Flow graphs, benchmark
rubrics) gets a ✨ button that opens a "Fill with AI" dialog. You type a free-text
description, pick a Provider, and the LLM returns structured JSON that the form
auto-fills. You always review and save — the LLM never touches the database
directly.

The dialog is **streaming-first**:
- Tokens appear as the model types. Reasoning tokens (Qwen3-thinking,
  DeepSeek-R1, OpenAI o-series) render in a collapsible italic-muted panel
  above the content panel.
- A red **Stop** button replaces Cancel while streaming; clicking it aborts
  the fetch and propagates `AbortController.signal` to the upstream provider so
  generation actually stops (not just hidden).
- A **max output tokens** slider (256 → 64 000) tunes the budget per call.
  Reasoning models default to higher per-kind caps (`flow-graph` 16k,
  `knowledge-entry` 32k).
- **Use example** pre-fills the prompt with a sensible default; **Randomize**
  asks the same provider to invent a domain-specific prompt (also streamed,
  also abortable). The randomize call is grounded in project context —
  taxonomy nodes for personas, the tool catalog for tools, existing entries
  for KB / tools so the LLM doesn't suggest duplicates.
- Open/close state lives in the URL (`?suggest=1`), so deep-links and refresh
  preserve the dialog.

Implementation:
- TS — `src/components/ai-assist-button.tsx` (single shared streaming dialog)
  and `src/lib/synthgen-api.ts` (typed client + `AiAssistKind` union).
- Python — `worker/synthgen/ai_assist.py` (per-kind structured-output prompts,
  tolerant JSON extractor that strips markdown fences, `jsonschema`-based
  self-verification for `tool-def` examples). `flow-graph` receives the
  project's tool catalog and `knowledge-entry` receives `AVAILABLE_TAXONOMY` as
  `extraContext` so referenced IDs stay in-bounds.
- API gate — `src/app/api/projects/[id]/ai-assist` enforces the per-kind RBAC
  action (`personas.write`, `flows.write`, `knowledge.write`, …) before
  delegating to the Python service. `?stream=1` proxies the NDJSON body straight
  through with `cache-control: no-store` and `x-accel-buffering: no` so live
  tokens stream end-to-end.

## RBAC model

**Global roles** (Auth.js / template) — `admin`, `member`. Global admin sees and
can act on every project. `member` users can list and create projects.

**Project roles** (per `ProjectMember`):

| Action | OWNER | EDITOR | ANNOTATOR | VIEWER |
|---|:---:|:---:|:---:|:---:|
| `project.read` | ✓ | ✓ | ✓ | ✓ |
| `project.update / delete / members.manage` | ✓ | | | |
| `providers.manage` | ✓ | ✓ | | |
| `taxonomy / personas / languages / tools / templates / flows / knowledge .write` | ✓ | ✓ | | |
| `runs.execute / runs.cancel` | ✓ | ✓ | | |
| `conversations.annotate` | ✓ | ✓ | ✓ | |
| `datasets.freeze / datasets.export` | ✓ | ✓ | | |
| `benchmarks.write / execute / cancel` | ✓ | ✓ | | |

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

## Localized realism — Malaysia bundled, every locale supported

This is the bit generic synth-data tools don't model. Three layers cooperate, and
none of them are Malay-specific in code — only in seeded data:

1. **System-prompt style guide** — `worker/synthgen/style_guide.py` auto-prepends
   instructions derived from the resolved `LanguageProfile`. For Malaysia formal:
   *"Respond in Formal Malay. Do not use Manglish particles … Use full standard
   spelling (`tidak` not `tak` …)."* For French enterprise: *"Respond in formal
   French using `vous`. Do not use anglicisms or SMS shortcuts (`tkt`, `svp`)."*
   The copy is templated against profile fields, not hardcoded per-language.
2. **Register-compliance validator** — `worker/synthgen/validators/register.py`.
   Word-bounded, case-insensitive blocklist match for the profile's banned tokens
   (Manglish particles for MS, anglicisms for FR/DE — whatever you put on the
   profile); regex blocklist for project-defined patterns; SMS-shortcut rejection
   when `requireFormalRegister` is on; allowlist policy for foreign-language
   loanwords. The validator never asks "which language is this?" — it just
   enforces the data.
3. **Per-project, per-locale tuning** — every field on `LanguageProfile` is
   editable. Telco teams ship with `router / modem / bil / bandwidth` in their
   loanword allowlist; bank teams ship with their own. Add a French formal
   profile, a German Sie profile, a Spanish voseo profile, etc., as you need
   them — same form, different data.

### What's locale-agnostic vs. Malaysia-tuned today

| Layer | Status |
|---|---|
| `LanguageProfile` schema (Prisma) | locale-agnostic |
| Style-guide rendering pipeline | locale-agnostic |
| Register-compliance validator | locale-agnostic |
| n-gram / schema validators | locale-agnostic |
| Generation worker + tool-call wiring | locale-agnostic |
| Code-switch policy mechanism | locale-agnostic |
| Formality precedence (Run > Persona > LP > Project) | locale-agnostic |
| Seeded `LanguageProfile` presets | **Malaysia-only** (2 presets) |
| Manglish particle list (`presets.MANGLISH_PARTICLES`) | **Malaysia-only** seed data |
| Formal-Malay shortcut list (`presets.FORMAL_MALAY_SHORTCUTS`) | **Malaysia-only** seed data |
| Function-word stoplist for lang-ID false-positive filter (`malay_words.py`) | **Malay-only** today |
| Lang-ID language set | currently `ms / en / zh / ta / id` — extend per locale |

### To ship out-of-the-box European support

The engine doesn't change. What you'd add:
- A few seeded `LanguageProfile` rows in `bootstrap.py` (e.g.
  `France – Enterprise Formal`, `France – Casual`,
  `Germany – Enterprise Formal (Sie)`, etc.) with the right banned-token /
  shortcut / allowlist data per locale.
- Extend the lang-ID language set in `validators/lang_id.py` to include
  `fr / de / es / it / pt / nl` etc.
- (Optional, advisory) Add small function-word stoplists per language to keep
  the loanword-allowlist validator from false-flagging native words.

That's it — no schema changes, no engine changes.

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
- Streaming generation worker (reasoning + content) with token-by-token
  preview in the run page + reasoning persistence on the assistant message
- `JobEvent` step-by-step trace timeline + downloadable provenance bundle
- Tool catalog (CRUD with AI-assist + synthetic argument examples + JSON
  Schema self-verify)
- Flow editor (React Flow + AI-generate w/ streaming + YAML round-trip)
- Multi-tool Action nodes (sequential / parallel)
- Project / persona / template / language-profile / taxonomy CRUD with
  streaming AI-assist (Use example + Randomize)
- Knowledge base — text / doc upload (PDF / DOCX / HTML / TXT) / URL crawler
  with depth-N BFS + cached `KnowledgeCrawl` results
- Provider reasoning controls (reasoning_effort + chat_template_kwargs)
- Conversation drawer with Messages / Trace tabs, filters / sort / pagination,
  JSON + Trace download
- Dashboard charts
- Invite-as-register flow
- OpenAI fine-tune JSONL export
- Function-Call benchmark format exporter

**Next slice**
- **Worker walks Flow graphs** — pick a path through the published flow, generate
  user/assistant turns turn-by-turn, mock-execute Action nodes' tools to produce
  realistic shaped responses (MyKad / LHDN / Maybank format for MY; SIRET / IBAN /
  IRS-equivalents for other locales).
- **Mock tool executor** — generates valid-looking outputs from `mockResponseSchema`
  + `mockSeed` on each ToolDef.
- **More locale seeds** — out-of-the-box `LanguageProfile` presets for FR-FR
  formal/casual, DE-DE Sie/du, ES-ES tú/usted/voseo, IT-IT lei/tu, plus the
  associated lang-ID extension and per-language function-word stoplists.
- **Judge-LLM validators** — per-axis rubrics (correctness, naturalness, language
  fidelity, code-switch realism, tool-arg validity), sampled (e.g. 10%) to keep cost
  bounded, calibrated against a human-rated gold set.
- **Annotation UI** at `/projects/[id]/annotate` — accept / reject / edit feeds
  rejected samples into DPO/KTO preference pairs.
- **Embedding-based KB retrieval** (pgvector) — swap the tag-based knowledge
  injection for semantic search when entry count outgrows tag matching.
- **Embedding-based dedup** (pgvector) — across-conversation deduplication.
- **More exporters** — ShareGPT, Alpaca, Parquet, HF Hub push.
- **Figma / Mermaid import** for flows.
- **Cost budgets per team**, adversarial slice presets, diversity dashboards,
  non-Latin script generation paths (Jawi, Han, Tamil, Cyrillic, Greek).

## Tech stack

- [Next.js 16](https://nextjs.org) + React 19 + Tailwind v4 + Radix UI
- [Auth.js v5](https://authjs.dev) — credentials, Azure AD, Google, Keycloak, SAML
- [Prisma 6](https://www.prisma.io) + Postgres 14+
- [`pg`](https://github.com/brianc/node-postgres) — used directly only for
  `LISTEN synthgen_job` (Prisma doesn't expose LISTEN/NOTIFY)
- [@xyflow/react](https://reactflow.dev) for the Flow editor
- [js-yaml](https://github.com/nodeca/js-yaml) for YAML round-trip
- [unpdf](https://github.com/unjs/unpdf) — PDF text extraction (serverless-friendly)
- [mammoth](https://github.com/mwilliamson/mammoth.js) — DOCX → text
- [html-to-text](https://github.com/html-to-text/node-html-to-text) — HTML → text (extract + crawl)
- Python 3.11+ + [FastAPI](https://fastapi.tiangolo.com) + [asyncpg](https://magicstack.github.io/asyncpg/)
- [lingua-py](https://github.com/pemistahl/lingua-py) for language detection
- [httpx](https://www.python-httpx.org/) for OpenAI-compat calls (streaming via `aiter_lines`)
- [jsonschema](https://github.com/python-jsonschema/jsonschema) — validates tool-def synthetic examples server-side
- [cryptography](https://cryptography.io/) for AES-256-GCM (matching Node's `crypto`)

## Default credentials

After `npm run db:seed`:

| Email | Password |
|---|---|
| `admin@example.com` | `admin1234` |

**Change these before deploying anywhere reachable.** Override with
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` before seeding.
