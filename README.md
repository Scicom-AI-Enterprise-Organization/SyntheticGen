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
- **Streaming function-calling** — `chat_completion_stream` understands
  `delta.tool_calls` chunks; the worker assembles them per-`index` and yields
  `tool_call_delta` events so tool invocations show up live in the preview as
  the model is still emitting them. Run cells with tools also stream a
  **mock-backend** synthetic-response LLM call (full reasoning + JSON
  materialize live) before the tool result lands. When tools are configured on
  a run, the worker prepends a **tool-catalog block** to the system prompt
  (name + description per tool) and sets `tool_choice: "auto"` — without that,
  some OpenAI-compat servers (vLLM in particular) leave the model refusing
  with "I don't have access" even though the catalog is in the request.
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
- **One-prompt project bootstrap** — `/projects/[id]/bootstrap` takes a single
  free-text prompt and generates an entire project's seed data end-to-end:
  taxonomy nodes → language profiles → personas → templates (system +
  user-seed) → tools → flows → rubrics → benchmarks. Each phase streams tokens
  live into a structured event log card. Resumable mid-stream — refresh and
  the orchestrator picks up from the last committed phase. The user-seed
  template's body is treated as an instruction prompt, NOT rendered verbatim
  as turn 1 — the worker uses it to LLM-generate a realistic first-person
  customer utterance per conversation, so the dataset doesn't leak
  template-style content into user messages.
- **Benchmarks with self-evaluation pipeline** — `/projects/[id]/benchmarks`
  scores generated conversations against a per-axis rubric using LLM-as-judge.
  Key features:
  - **Judge-only mode** — the judge evaluates the existing reference
    assistant turns; no candidate model is re-invoked. Avoids the
    classic "judge same as candidate" leniency where the model
    rubber-stamps its own output as 5/5.
  - **One-shot vs per-turn judging** — score the whole conversation in
    one call (cheap, holistic) or one call per turn (N× cost, finer
    grained — writes one BenchmarkResult per turn AND a rolled-up
    conversation-level row with averaged scores + worst verdict).
  - **Turn-block grouping** — multi-turn conversations with tool calls
    are grouped by user message position (one block = user turn +
    assistant tool_call + tool result + follow-up text), so the judge
    scores each user turn as a unit, not split per assistant message.
  - **Strict judge prompt** — forces per-axis fault enumeration before
    scoring with explicit calibration anchors, with retry on malformed
    JSON (configurable up to 10 attempts, temperature bumped per retry).
  - **Parallel item processing** — semaphore-bounded gather; default 4
    concurrent items per run, configurable via slider.
  - **Resumable runs** — restart can be "fresh" (wipe all
    BenchmarkResult rows) or "resume" (keep them, skip the rowIdx
    values already judged). After a worker crash, click Resume to pick
    up from the last persisted row.
  - **Background queue worker** — benchmark runs are claimed by a
    dedicated consumer pool inside the `synthgen-worker` container via
    `SELECT … FOR UPDATE SKIP LOCKED`, so api restarts no longer kill
    in-flight runs.
  - **Multi-tab live preview** — tile row of in-flight items
    (concurrent, color-coded by verdict); click any tile to focus its
    streaming candidate + judge panes. Judge output streams token-by-
    token (the full JSON output including scores), candidate is replayed
    full-turn-at-a-time (no model re-invocation in judge-only mode).
  - **Calibration set + drift detector** — flag conversations with
    `isCalibration=true` and human-rated `calibrationExpected` scores.
    Every benchmark run re-judges them up front and flags the run if
    the judge's scores drift from baseline beyond a threshold.
    Surfaced as a green/red banner on the run page so reviewers know
    whether to trust the rankings.
  - **Export top-K% to labeling platform** — once a run completes,
    stratified-sample the best conversations (by composite axis score,
    grouped by split × persona × taxonomy, deduped via `dedupHash`) and
    push them as a `human_mos` project on a labeling platform for human
    spot-check. Labeling platform connection (base URL + bearer token)
    is configured once per project under Settings, encrypted at rest
    with the same AES-256-GCM helper as provider credentials. Includes
    a Test-connection button against the platform's `/api/auth/me`
    endpoint, and Save is gated on a passing test so wrong credentials
    don't get persisted.
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
  `GenerationJob` and streams its activity into a card via Postgres
  `LISTEN synthgen_job`. The view is **block-based**, not raw text: the worker
  emits typed events (`turn.user`, `turn.assistant`, `turn.followup`,
  `tool.call.frag` / `tool.call.complete`, `tool.mock.start`, `tool.result`,
  `delta`) and the client renders each as a coloured card — User turns,
  Assistant headers, Tool calls (with streamed args), Mock-backend status,
  Tool results, plus reasoning/content text segments. Reasoning is persisted
  on every assistant `Message` row (first turn + multi-turn + tool-aware) for
  later inspection. **Stop** cancels the current job (closes the SSE and marks
  the row cancelled); **Restart** re-queues from any state, including already
  `succeeded` — the run flips back to `running` so the live cards re-mount.
- **Conversation trace tab** — every conversation has a step-by-step
  `JobEvent` timeline: job picked up → context loaded → prompt rendered →
  provider request → reasoning/content stream → validators → persistence. The
  drawer has Messages / Trace tabs (URL-synced), JSON / Trace download buttons,
  an **Open run page · &lt;name&gt;** back-link above the tabs, a **Settings
  panel** on the Messages tab summarising the frozen `settingsSnapshot` (mode,
  model, provider, template, language profile, persona, taxonomy, formality,
  sampling, tools available, tools actually invoked), and renders the full
  provenance (run config, template body, persona snapshot, language profile,
  provider, KB entries used). Per-message rows are collapsible `<details>`
  with role-coloured borders; assistant rows with `tool_calls` show the
  function/arguments next to the (possibly empty) content. Conversations are
  filterable by topic / language / status, sortable, paginated, and support
  **bulk select + delete** (frozen-dataset rows are skipped with per-id
  reasons surfaced inline).
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
                                       │ NOTIFY synthgen_run        (job done)
                                       │ NOTIFY synthgen_job        (per-token live stream)
                                       │ NOTIFY synthgen_benchmark  (per-item + per-turn benchmark stream)
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
        bootstrap/     One-prompt project generator + live streaming progress
        benchmarks/    Chat-replay benchmarks: rubric-scored runs, judge-only
                       evaluation, per-turn vs one-shot, parallel items,
                       resumable / cancellable, live multi-tab preview,
                       calibration drift detection, top-K% export to a
                       labeling platform for human spot-check
        rubrics/       Per-axis rubrics (name, key, scale, description,
                       example anchors) consumed by benchmark judges
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
      benchmarks/[bid]/runs/[rid]/
        stream/                         LISTEN synthgen_benchmark → per-item +
                                        per-turn SSE for the Live Benchmark
                                        Preview (item.start/done/error,
                                        candidate.replay, judge.start/delta,
                                        run.done). Terminal runs replay from
                                        the in-memory cache OR rebuild from
                                        BenchmarkResult rows when the cache
                                        has been evicted.
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
    bootstrap-bus.ts   Process-wide in-memory bus for bootstrap streaming
    job-event-cache.ts Process-wide LISTEN client for synthgen_job events —
                       buffers per-jobId so SSE refresh replays the stream
    benchmark-event-cache.ts  Same pattern for synthgen_benchmark events
worker/                Python service
  synthgen/
    presets.py         Manglish particles, Formal-Malay shortcuts, loanword allowlists
    style_guide.py     Auto-injected formality system-prompt fragment
    templates.py       Mustache renderer (supports {{knowledge}}, {{taxonomy.related}})
    providers.py       httpx OpenAI-compat client — non-streaming + streaming
                       (incl. tool_calls deltas assembled per-`index`), with
                       stream_options.include_usage, tool_choice="auto" when
                       tools are present, per-call reasoning_effort +
                       chat_template_kwargs
    validators/        schema, lang_id (lingua-py), register, ngram
    generation.py      Single-turn + multi-turn pipeline w/ streaming,
                       JobEvent timeline, knowledge-base injection, related
                       topics, structured pg_notify events (turn.user,
                       tool.call.*, tool.mock.start, tool.result) for the live
                       preview, reasoning persistence on every assistant turn
    exporter.py        OpenAI JSONL writer
    bootstrap.py       Seed default LanguageProfile presets per project
    ai_assist.py       Per-kind structured-output prompts + tolerant JSON
                       extractor + jsonschema-based tool-def example verifier
    api/main.py        FastAPI internal endpoints (incl. NDJSON streaming
                       /internal/ai-assist/stream + /internal/random-prompt/stream).
                       Also tracks _running_tasks per jobId so cancel
                       endpoints actually abort in-flight LLM HTTP calls
                       via task.cancel() — not just flip the DB row.
    jobworker/main.py  Job poller (SELECT ... FOR UPDATE SKIP LOCKED) +
                       benchmark-run consumer pool that claims queued
                       BenchmarkRun rows the same way. Separate consumer
                       count (BENCHMARK_WORKER_CONCURRENCY, default 2).
    benchmarks/
      runner.py        execute_benchmark_run dispatcher (function-call
                       + chat-replay)
      chat_replay.py   Chat-replay benchmark engine: turn-block grouping,
                       per-turn vs one-shot judging, parallel item
                       dispatch via semaphore-bounded gather, incremental
                       metrics rollup after every item, calibration set
                       re-judge at run start with drift detection
      judge.py         Strict judge prompt (per-axis fault enumeration,
                       calibration anchors), call_judge_streaming with
                       retry-on-malformed-JSON (configurable up to 10
                       attempts, temperature bumped per retry)
      scoring.py       Function-call rubric scoring helpers
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
7. **Add a PromptTemplate** under *Templates*. Uses `{{persona.name}}`,
   `{{taxonomy.path}}`, `{{language.primary}}`. ✨ Fill with AI works here too,
   and existing templates can be edited via the pencil icon (body changes bump
   the template version so historical runs keep their frozen snapshot).
8. **Start a Run** under *Runs → New run*. The wizard is **tab-driven**:
   *Single-turn (manual grid)* drives `taxonomyNodes × personas ×
   conversations-per-combination` with Turns / Related-topics knobs and a Tools
   multiselect; *Flow-driven* hides those and uses `flows × personas ×
   conversations-per-combination` instead (the chosen flow owns its own
   topics, tool wiring, and turn count graph-style). Either way: slide
   **Temperature** + **Max output tokens**, use the **Formality lock** to
   force a register override, and submit.
9. **Watch progress** — the run detail page subscribes to SSE; counts and cost
   update live; a **Live job preview** card streams the running job as
   structured blocks (User turns, Tool calls with live args, Mock-backend
   reasoning, Tool results, Assistant reasoning + content). The same page has
   a paginated, filterable, sortable **Jobs table** below — each row links to
   its generated conversation (eye icon) and exposes an inline restart icon
   (works for `succeeded` jobs too — the old conversation is orphaned, not
   deleted, and the run flips back to `running` so live cards re-mount).
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

## Benchmarks — self-evaluation pipeline

`/projects/[id]/benchmarks` lets you score generated conversations against a
per-axis rubric using LLM-as-judge, then pick the best ones for human review.

**Flow:**

1. **Create a benchmark** (`/benchmarks/new`) — pick a source `GenerationRun`
   or filter (persona × taxonomy × language), sample size, default rubric.
   The conversation list is frozen at create time as
   `Benchmark.frozenConversationIds` so subsequent runs evaluate the same
   items even if the source run is later mutated.

2. **Start a run** — pick an **ensemble judge group** (manage these on
   the Benchmarks page → *Ensemble judge groups*). A group of 1 judge
   runs single-judge; ≥2 judges runs **consensus** (median / mean / min
   per-axis aggregation, worst verdict, max disagreement per axis). The
   form also configures judge sampling (temperature / max_tokens /
   strategy: one-shot vs per-turn), replay mode (single-turn /
   multi-turn), parallel item count (default 4), and retry count for
   malformed judge JSON (default 3). Each benchmark can set a *default
   ensemble group* that's auto-selected here and in the re-judge dialog.

3. **Worker grades each conversation**. In **judge-only mode** (default,
   recommended), the worker takes the EXISTING reference assistant turns
   from each conversation and feeds them to the judge — no candidate model
   is re-invoked. The judge sees the conversation context + the assistant's
   response and grades each axis with a hardcoded **per-axis fault
   enumeration** step (the judge MUST list one fault per axis or explain
   why none exists before scoring), with explicit calibration anchors
   ("top = no improvement I'd make", "top-1 = one minor polish", etc.).

4. **Turn-block grouping** — multi-turn conversations with tool calls are
   grouped by user-message position. One block = `[user]` + everything
   between it and the next `[user]` (so `tool_call` assistant message +
   `tool` result + follow-up `assistant` text are all ONE turn block). The
   per-turn judge scores each block once, instead of treating each
   assistant message as a separate turn (which would slip the pairing
   every time the assistant uses a tool).

5. **Multi-tab live preview** — the run page subscribes to
   `synthgen_benchmark` pg_notify events and renders a tile row of active
   items (color-coded green/amber/red by verdict as they complete). Click
   any tile to focus its candidate (assistant turns being scored) + judge
   (streaming JSON output with scores) panes. Per-turn mode renders one
   row per turn so turn 1 candidate aligns with turn 1 rationale, etc.

6. **Resumable** — Restart has two modes:
   - **Fresh** wipes every `BenchmarkResult` row and re-judges from scratch.
   - **Resume** keeps the existing rows and only judges items whose
     `rowIdx` isn't already in `BenchmarkResult` for this run. Use after
     a crash, a manual cancel, or a worker container reload — the next
     run picks up exactly where it stopped.

7. **Background queue** — benchmark runs are NOT executed in the api
   process anymore. The `synthgen-worker` container runs a dedicated
   consumer pool (default 2 simultaneous runs) that claims
   `BenchmarkRun` rows in `status='queued'` via `SELECT ... FOR UPDATE
   SKIP LOCKED`. Survives uvicorn reloads, multi-container scale-out
   without double-claim.

8. **Calibration set + drift detector** — flag conversations with
   `isCalibration=true` and hand-rated `calibrationExpected` per-axis
   scores. Every chat-replay run re-judges these at start, compares
   actual scores to baseline, and sets `BenchmarkRun.calibrationReport`
   with `{ items, maxDelta, meanDelta, driftFlagged, threshold }`. The
   run page shows a green or red banner so reviewers know whether to
   trust the rankings.

9. **Top-K% export to labeling platform** — once a run completes, click
   "Export top % to labeling" on the run page header. The selector:
   - filters out `verdict='fail'` rows;
   - keeps anything with all axes ≥ `minAxisScore` (slider 1–5);
   - groups by `(split × personaId × taxonomyNodeId)` cells;
   - dedupes via `Conversation.dedupHash`;
   - round-robin picks the best from each cell until target count
     (`ceil(passing * percent)`) is reached;
   - creates a `human_mos` project on the labeling platform, configures
     its MOS axes from the rubric, uploads picks as tasks (batched 100
     at a time);
   - the labeling platform connection (base URL + bearer token) is
     stored once per project under Settings → Labeling platform,
     encrypted with the same AES-256-GCM helper as provider
     credentials. A **Test connection** button hits the platform's
     `/api/auth/me` endpoint to verify before save; Save is gated on
     a passing test.

**Why a Tier-1 / Tier-2 / Tier-3 split for 100k-scale curation:**

The benchmark engine is designed to be Tier 2 in a three-tier filter:

| Tier | Filter | Cost | Throughput |
|---|---|---|---|
| 1 | Deterministic validators (lang-id, register, schema, ngram) | $0 | ~instant |
| 2 | LLM-as-judge with strict per-axis prompt (this) | $0.001–0.01/item | ~30 items/min/worker |
| 3 | Multi-judge consensus or stronger model on the top % | $0.05–0.20/item | bounded by selection |

100k generations → Tier 1 kills ~30-50% → Tier 2 ranks the ~50k
survivors → Tier 3 (separate run with a stronger judge model) or
human-MOS export validates the top 1%.

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
| `WORKER_CONCURRENCY` | `4` | Number of in-process generation-job consumer coroutines |
| `BENCHMARK_WORKER_CONCURRENCY` | `2` | Number of in-process benchmark-run consumer coroutines (each run handles its own item-level parallelism via samplingParams.concurrency) |

## Roadmap

**Done**
- Single-turn + multi-turn generation with formality lock + cheap validators
- Streaming generation worker (reasoning + content) with per-job structured
  live preview (User / Assistant / Tool-call / Mock-backend / Tool-result
  blocks instead of inline text labels), Stop + Restart per-job, reasoning
  persistence on every assistant `Message` row (turn 1, multi-turn, and
  tool-aware paths)
- **Streaming function-calling** — provider stream client assembles
  `delta.tool_calls` per-`index`, worker emits live `tool_call_delta` events,
  tool-catalog auto-injected into system prompt with `tool_choice: "auto"` so
  vLLM-class servers actually invoke tools; mock-backend tool-response LLM
  call streams its own reasoning + JSON live
- Multi-turn user-simulator forces `enable_thinking: false` + reuses the run's
  `max_tokens` so reasoning models don't burn the whole budget on `<think>`
  and silently truncate the conversation
- `JobEvent` step-by-step trace timeline + downloadable provenance bundle
- Tool catalog (CRUD with AI-assist + synthetic argument examples + JSON
  Schema self-verify)
- Flow editor (React Flow + AI-generate w/ streaming + YAML round-trip)
- Multi-tool Action nodes (sequential / parallel)
- Run wizard with tabbed single-turn / flow-driven modes (difficulty axis
  retired — templates are the sole driver of question difficulty)
- Run detail page: paginated/sortable Jobs table with per-row eye/restart
  icons, single-job cancel endpoint, run-level Settings card resolving every
  configSnapshot id to a human name
- Project / persona / template / language-profile / taxonomy CRUD with
  streaming AI-assist (Use example + Randomize) — templates now editable
  in-place with version-bump-on-body-change
- Knowledge base — text / doc upload (PDF / DOCX / HTML / TXT) / URL crawler
  with depth-N BFS + cached `KnowledgeCrawl` results
- Provider reasoning controls (reasoning_effort + chat_template_kwargs)
- Conversation drawer with Messages / Trace tabs, per-message collapsible
  rows, **Open run page** back-link above the tabs, **Settings panel**
  (frozen snapshot or derived-from-run fallback w/ resolved tool names),
  filters / sort / pagination, bulk-select delete (frozen-dataset rows
  surfaced as inline reasons), JSON + Trace download
- Runs list paginated 25/page with Created / Updated sortable columns
- Dashboard charts
- Invite-as-register flow
- OpenAI fine-tune JSONL export
- Function-Call benchmark format exporter
- No-toast policy throughout — every transient notification is inline UI
  (status banner, button flash, destructive panel) so nothing disappears
  before the user reads it
- **One-prompt project bootstrap** — taxonomy → languages → personas →
  templates → tools → flows → rubrics → benchmarks, all from a single
  free-text prompt, streaming live; resumable via `currentPhaseBuffer`;
  body-shape heuristic + user-seed-as-instructions so templates don't
  leak into user turns
- **Benchmarks with judge-only scoring** — chat-replay benchmarks score
  reference conversations against a per-axis rubric; one-shot vs
  per-turn judge strategy; strict judge prompt with per-axis fault
  enumeration + calibration anchors + retry-on-malformed-JSON
- **Turn-block grouping** in multi-turn benchmarks so tool-call +
  follow-up text are scored as one logical turn, not as separate
  pair-mismatched messages
- **Parallel item processing** within a benchmark run (semaphore-bounded
  gather, configurable concurrency 1-16)
- **Resumable benchmark runs** — Restart distinguishes "fresh" (wipe
  results) from "resume" (keep them, skip already-judged rowIdx values)
- **Background benchmark queue** — dedicated consumer pool in the
  worker container claims `BenchmarkRun` rows via SKIP LOCKED;
  survives api/worker restarts
- **Real cancellation** — `_running_tasks` registry on the api lets
  cancel routes call `asyncio.Task.cancel()` to abort in-flight
  `httpx.AsyncClient.stream()` calls at the network layer, instead of
  letting the model run to completion after the DB row is already
  marked cancelled
- **Multi-tab live benchmark preview** — tiles for in-flight items,
  click to focus, streaming candidate + judge panes per turn,
  calibration drift banner on the run page
- **Calibration set + drift detector** — flag conversations as
  baseline with `isCalibration=true` + `calibrationExpected` scores;
  every benchmark run re-judges them at start and flags the run if the
  judge drifts beyond a threshold
- **Top-K% export to labeling platform** — stratified-sample best
  conversations (split × persona × taxonomy) and push as a `human_mos`
  project on a labeling platform for human spot-check; platform
  credentials stored encrypted per-project under Settings with a
  Test-connection button gating Save

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
- **Judge-LLM ensemble** — second-pass strong judge (Claude / GPT-4) on
  the top % from the Tier-2 ranking, with multi-judge consensus and
  disagreement flagging for human review. Current single-judge pipeline
  already ships (see "Benchmarks" section).
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
