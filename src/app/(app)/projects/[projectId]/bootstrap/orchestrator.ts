// Background orchestrator for the "Bootstrap" project setup.
//
// One BootstrapJob row drives the whole pipeline. The runner:
//   1. Goes phase by phase (taxonomy → languages → personas → templates →
//      tools → flows). Phases are independent; later phases can read what
//      earlier phases inserted (e.g. personas can reference a language profile
//      we just created).
//   2. For each phase, calls aiAssist N times with prompt-engineering hints
//      so we get a varied set rather than N duplicates.
//   3. Inserts each parsed entity directly via Prisma (no permission checks —
//      the user was already authorised when starting the job).
//   4. Appends a structured event to BootstrapJob.events for every meaningful
//      transition. The /stream SSE endpoint replays + tails this array.
//
// Behaviour is APPEND-ONLY (per the user choice): we never delete or update
// existing project entities. Name collisions are skipped with a warning
// event — re-running the bootstrap on a populated project is safe.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aiAssistStream, type AiAssistKind } from "@/lib/synthgen-api";
import { getBus, releaseBus } from "@/lib/bootstrap-bus";

class BootstrapCancelledError extends Error {
  constructor() {
    super("BOOTSTRAP_CANCELLED");
    this.name = "BootstrapCancelledError";
  }
}

// Cheap status probe used between AI calls so a `cancelled` flip from the UI
// stops the orchestrator mid-phase rather than waiting for a phase boundary.
async function assertNotCancelled(jobId: string): Promise<void> {
  const row = await prisma.bootstrapJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (row?.status === "cancelled") {
    throw new BootstrapCancelledError();
  }
}

export type BootstrapStep =
  | "taxonomy"
  | "languages"
  | "personas"
  | "templates"
  | "tools"
  | "flows"
  | "rubrics"
  | "benchmarks";

export interface BootstrapScope {
  taxonomy: boolean;
  languages: boolean;
  personas: boolean;
  templates: boolean;
  tools: boolean;
  flows: boolean;
  rubrics: boolean;
  benchmarks: boolean;
}

export const STEP_ORDER: BootstrapStep[] = [
  "taxonomy",
  "languages",
  "personas",
  "templates",
  "tools",
  "flows",
  "rubrics",
  "benchmarks",
];

export interface BootstrapEvent {
  idx: number;
  ts: string;
  step: BootstrapStep | "init" | "done";
  // step-start | step-progress | step-done | step-error | inserted | warning |
  // skipped | done | error
  kind:
    | "step-start"
    | "step-progress"
    | "step-done"
    | "step-error"
    | "inserted"
    | "warning"
    | "skipped"
    | "done"
    | "error";
  payload?: Record<string, unknown>;
}

const TARGETS = {
  taxonomy: 8,
  languages: 2,
  personas: 4,
  templates: 2,
  tools: 3,
  flows: 1,
  rubrics: 1,
  benchmarks: 1,
} as const;

// Phase-specific seed hints get appended to the user prompt so successive
// aiAssist calls produce a diverse set of N entities instead of repeating.
const PHASE_HINTS: Record<BootstrapStep, string[]> = {
  taxonomy: [
    "billing and payments topic",
    "account access / login topic",
    "service outage or technical issue topic",
    "plan or product enquiry topic",
    "complaint / dispute topic",
    "feedback / suggestion topic",
    "fraud / security concern topic",
    "policy / FAQ topic",
  ],
  languages: [
    "formal register, no Manglish particles, strict spelling",
    "casual Manglish-friendly register, code-switching encouraged",
  ],
  personas: [
    "a young urban customer, code-switches between Bahasa and English",
    "a rural kampung customer with limited English fluency",
    "a senior Chinese-Malaysian customer preferring formal register",
    "an Indian-Malaysian customer in a mid-size city, professional context",
  ],
  templates: [
    "system-prompt template that locks the assistant to the project's locale + register, mentions persona variables",
    "user-seed template producing a realistic single-turn customer inquiry referencing taxonomy.path and persona.region",
  ],
  tools: [
    "a function that looks up an account or record by an identifier",
    "a function that checks the status of an in-flight request, ticket, or order",
    "a function that performs an update / action and confirms it succeeded",
  ],
  flows: [
    "a multi-turn customer-support flow: greeting → intent identification → information lookup (tool call) → resolution → close. Use only the existing tools and templates from this project.",
  ],
  rubrics: [
    "a rubric judging language fidelity, register/formality compliance, helpfulness, factual accuracy, and refusal behaviour for the project's locale and domain",
  ],
  // Benchmarks are not AI-generated; we materialise a single chat-replay
  // benchmark referencing the first generated rubric. The hint here is only
  // used as a description.
  benchmarks: [
    "default chat-replay benchmark over accepted project conversations",
  ],
};

// Only the AI-driven phases map to an AiAssistKind. Benchmarks are generated
// without LLM help — see runBenchmarksPhase below.
const KIND_FOR_STEP: Partial<Record<BootstrapStep, AiAssistKind>> = {
  taxonomy: "taxonomy-node",
  languages: "language-profile",
  personas: "persona",
  templates: "prompt-template",
  tools: "tool-def",
  flows: "flow-graph",
  rubrics: "benchmark-rubric",
};

interface JobRow {
  id: string;
  projectId: string;
  prompt: string;
  providerId: string;
  model: string | null;
  temperature: number | null;
  maxTokens: number | null;
  scope: BootstrapScope;
  events: BootstrapEvent[];
  inserted: Record<string, number>;
  createdById: string | null;
}

async function loadJob(jobId: string): Promise<JobRow | null> {
  const row = await prisma.bootstrapJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      projectId: true,
      prompt: true,
      providerId: true,
      model: true,
      temperature: true,
      maxTokens: true,
      scope: true,
      events: true,
      inserted: true,
      createdById: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    prompt: row.prompt,
    providerId: row.providerId,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    scope: row.scope as unknown as BootstrapScope,
    events: (row.events as unknown as BootstrapEvent[]) ?? [],
    inserted: (row.inserted as unknown as Record<string, number>) ?? {},
    createdById: row.createdById,
  };
}

async function appendEvent(
  jobId: string,
  evt: Omit<BootstrapEvent, "idx" | "ts">,
): Promise<void> {
  // Read-modify-write. Single orchestrator per job → no concurrent writers.
  const row = await prisma.bootstrapJob.findUnique({
    where: { id: jobId },
    select: { events: true },
  });
  const current = ((row?.events as unknown as BootstrapEvent[]) ?? []).slice();
  const next: BootstrapEvent = {
    idx: current.length,
    ts: new Date().toISOString(),
    ...evt,
  };
  current.push(next);
  await prisma.bootstrapJob.update({
    where: { id: jobId },
    data: { events: current as unknown as Prisma.InputJsonValue },
  });
}

async function bumpInserted(
  jobId: string,
  step: BootstrapStep,
  delta = 1,
): Promise<void> {
  const row = await prisma.bootstrapJob.findUnique({
    where: { id: jobId },
    select: { inserted: true },
  });
  const cur = ((row?.inserted as unknown as Record<string, number>) ?? {});
  const next = { ...cur, [step]: (cur[step] ?? 0) + delta };
  await prisma.bootstrapJob.update({
    where: { id: jobId },
    data: { inserted: next as unknown as Prisma.InputJsonValue },
  });
}

// ---------------------------------------------------------------------------
// Per-entity insert helpers (all are append-only with name-collision skipping)
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "node"
  );
}

async function ensureTaxonomy(projectId: string): Promise<string> {
  // Use the first taxonomy for the project; create one if none exists.
  const existing = await prisma.taxonomy.findFirst({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.taxonomy.create({
    data: { projectId, name: "default", description: "Auto-created by bootstrap" },
  });
  return created.id;
}

async function ensureDefaultCatalog(projectId: string): Promise<string> {
  const existing = await prisma.toolCatalog.findFirst({
    where: { projectId, name: "default" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.toolCatalog.create({
    data: { projectId, name: "default", description: "Auto-created by bootstrap" },
  });
  return created.id;
}

async function insertTaxonomyNode(
  projectId: string,
  taxonomyId: string,
  raw: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string; id?: string; name?: string }> {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, reason: "AI returned no name" };

  const slug = slugify(name);
  const dup = await prisma.taxonomyNode.findFirst({
    where: { taxonomyId, slug },
    select: { id: true },
  });
  if (dup) return { ok: false, reason: "name already exists", name };

  const created = await prisma.taxonomyNode.create({
    data: {
      taxonomyId,
      parentId: null,
      name,
      slug,
      path: `/${slug}`,
      depth: 1,
    },
  });
  return { ok: true, id: created.id, name };
}

async function insertLanguageProfile(
  projectId: string,
  raw: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string; id?: string; name?: string }> {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, reason: "AI returned no name" };

  const dup = await prisma.languageProfile.findFirst({
    where: { projectId, name },
    select: { id: true },
  });
  if (dup) return { ok: false, reason: "name already exists", name };

  const allowedPrimary = ["ms", "en", "zh", "ta"];
  const allowedScript = ["latin", "jawi", "hans", "hant", "tamil"];
  const allowedSwitch = ["none", "inter-sentential", "intra-sentential", "rojak"];
  const allowedRegister = ["formal", "semi-formal", "colloquial", "mixed"];
  const allowedLoan = ["forbid", "allowlist", "free"];

  const pickStr = (k: string, allowed: string[], fallback: string): string => {
    const v = raw[k];
    return typeof v === "string" && allowed.includes(v) ? v : fallback;
  };
  const arrayOfStrings = (k: string): string[] =>
    Array.isArray(raw[k])
      ? ((raw[k] as unknown[]).filter((x): x is string => typeof x === "string"))
      : [];

  const created = await prisma.languageProfile.create({
    data: {
      projectId,
      name,
      primary: pickStr("primary", allowedPrimary, "ms"),
      secondary: arrayOfStrings("secondary").filter((s) => allowedPrimary.includes(s)),
      script: pickStr("script", allowedScript, "latin"),
      codeSwitchPolicy: pickStr("codeSwitchPolicy", allowedSwitch, "none"),
      codeSwitchRate:
        typeof raw.codeSwitchRate === "number"
          ? Math.max(0, Math.min(1, raw.codeSwitchRate))
          : null,
      register: pickStr("register", allowedRegister, "formal"),
      allowParticles: raw.allowParticles === true,
      bannedTokens: arrayOfStrings("bannedTokens"),
      bannedPatterns: arrayOfStrings("bannedPatterns"),
      requireFormalMalay: raw.requireFormalMalay === true,
      englishLoanwordPolicy: pickStr("englishLoanwordPolicy", allowedLoan, "free"),
      loanwordAllowlist: arrayOfStrings("loanwordAllowlist"),
      dialectHints: arrayOfStrings("dialectHints"),
      notes: typeof raw.notes === "string" ? raw.notes : null,
    },
  });
  return { ok: true, id: created.id, name };
}

async function insertPersona(
  projectId: string,
  raw: Record<string, unknown>,
  languageProfileIds: string[],
): Promise<{ ok: boolean; reason?: string; id?: string; name?: string }> {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, reason: "AI returned no name" };

  const dup = await prisma.persona.findFirst({
    where: { projectId, name },
    select: { id: true },
  });
  if (dup) return { ok: false, reason: "name already exists", name };

  const allowedUrbanity = ["urban", "suburban", "kampung"];
  const allowedFormality = ["baku", "colloquial", "manglish", "mixed"];

  // Pick a language profile to link, if any — choose by formality fit when we can.
  let langId: string | null = null;
  if (languageProfileIds.length > 0) {
    const formality =
      typeof raw.formality === "string" ? raw.formality : null;
    if (formality === "baku" && languageProfileIds.length > 0) {
      langId = languageProfileIds[0];
    } else {
      langId =
        languageProfileIds[languageProfileIds.length > 1 ? 1 : 0] ?? null;
    }
  }

  const created = await prisma.persona.create({
    data: {
      projectId,
      name,
      description:
        typeof raw.description === "string" ? raw.description : null,
      ethnicity: typeof raw.ethnicity === "string" ? raw.ethnicity : null,
      region: typeof raw.region === "string" ? raw.region : null,
      urbanity:
        typeof raw.urbanity === "string" && allowedUrbanity.includes(raw.urbanity)
          ? raw.urbanity
          : null,
      ageRange: typeof raw.ageRange === "string" ? raw.ageRange : null,
      gender: null,
      occupation: typeof raw.occupation === "string" ? raw.occupation : null,
      formality:
        typeof raw.formality === "string" && allowedFormality.includes(raw.formality)
          ? raw.formality
          : null,
      religionAware: raw.religionAware === true,
      dialectTags: Array.isArray(raw.dialectTags)
        ? (raw.dialectTags as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [],
      languageProfileId: langId,
    },
  });
  return { ok: true, id: created.id, name };
}

async function insertTemplate(
  projectId: string,
  raw: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string; id?: string; name?: string }> {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const body = typeof raw.body === "string" ? raw.body : "";
  if (!name) return { ok: false, reason: "AI returned no name" };
  if (!body) return { ok: false, reason: "AI returned no body" };

  const dup = await prisma.promptTemplate.findFirst({
    where: { projectId, name },
    select: { id: true },
  });
  if (dup) return { ok: false, reason: "name already exists", name };

  const allowedKind = ["system", "user-seed", "judge", "conversation-driver"];
  const kind =
    typeof raw.kind === "string" && allowedKind.includes(raw.kind)
      ? raw.kind
      : "user-seed";

  const created = await prisma.promptTemplate.create({
    data: {
      projectId,
      name,
      description:
        typeof raw.description === "string" ? raw.description : null,
      kind,
      body,
    },
  });
  return { ok: true, id: created.id, name };
}

async function insertToolDef(
  projectId: string,
  catalogId: string,
  raw: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string; id?: string; name?: string }> {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, reason: "AI returned no name" };
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return { ok: false, reason: `invalid identifier "${name}"` };
  }

  const dup = await prisma.toolDef.findFirst({
    where: { catalogId, name },
    select: { id: true },
  });
  if (dup) return { ok: false, reason: "name already exists", name };

  let parameters: Prisma.InputJsonValue;
  if (
    raw.parameters &&
    typeof raw.parameters === "object" &&
    !Array.isArray(raw.parameters)
  ) {
    parameters = raw.parameters as Prisma.InputJsonValue;
  } else {
    return { ok: false, reason: "AI returned no parameters JSON schema" };
  }

  const examples = Array.isArray(raw.examples)
    ? ((raw.examples as unknown[]).filter(
        (x): x is Record<string, unknown> =>
          x !== null && typeof x === "object" && !Array.isArray(x),
      ))
    : [];

  const created = await prisma.toolDef.create({
    data: {
      catalogId,
      name,
      description:
        typeof raw.description === "string" ? raw.description : "",
      parameters,
      localePresets: Array.isArray(raw.localePresets)
        ? (raw.localePresets as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [],
      examples:
        examples.length > 0
          ? (examples as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });
  return { ok: true, id: created.id, name };
}

async function insertRubric(
  projectId: string,
  createdById: string | null,
  raw: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string; id?: string; name?: string }> {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, reason: "AI returned no name" };

  const dup = await prisma.rubric.findFirst({
    where: { projectId, name },
    select: { id: true },
  });
  if (dup) return { ok: false, reason: "name already exists", name };

  const axesRaw = Array.isArray(raw.axes) ? raw.axes : [];
  const axes = axesRaw
    .map((a) => {
      if (!a || typeof a !== "object") return null;
      const r = a as Record<string, unknown>;
      const key = typeof r.key === "string" ? r.key : "";
      const axisName = typeof r.name === "string" ? r.name : key;
      const desc = typeof r.description === "string" ? r.description : "";
      const scale =
        typeof r.scale === "number"
          ? r.scale
          : Number.parseInt(String(r.scale ?? "5"), 10) || 5;
      const weight =
        typeof r.weight === "number"
          ? r.weight
          : Number.parseFloat(String(r.weight ?? "1")) || 1;
      if (!key || !axisName) return null;
      return { key, name: axisName, description: desc, scale, weight };
    })
    .filter((x): x is { key: string; name: string; description: string; scale: number; weight: number } => x !== null);

  if (axes.length === 0) return { ok: false, reason: "AI returned no axes" };

  const created = await prisma.rubric.create({
    data: {
      projectId,
      name,
      description: typeof raw.description === "string" ? raw.description : null,
      axes: axes as unknown as Prisma.InputJsonValue,
      aiDrafted: true,
      createdById,
    },
  });
  return { ok: true, id: created.id, name };
}

async function insertBenchmark(
  projectId: string,
  createdById: string | null,
  defaultRubricId: string | null,
  name: string,
  description: string,
): Promise<{ ok: boolean; reason?: string; id?: string; name?: string }> {
  const dup = await prisma.benchmark.findFirst({
    where: { projectId, name },
    select: { id: true },
  });
  if (dup) return { ok: false, reason: "name already exists", name };

  if (!createdById) {
    return { ok: false, reason: "no creator user attached to this job" };
  }

  const created = await prisma.benchmark.create({
    data: {
      projectId,
      name,
      description,
      kind: "project-chat-replay",
      source: "project-filter",
      splits: [],
      maxRowsPerSplit: 50,
      config: {
        mode: "multi-turn",
        filter: { statuses: ["accepted"], limit: 50 },
      } as unknown as Prisma.InputJsonValue,
      frozenConversationIds: [],
      defaultRubricId,
      createdById,
    },
  });
  return { ok: true, id: created.id, name };
}

async function insertFlow(
  projectId: string,
  raw: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string; id?: string; name?: string }> {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, reason: "AI returned no name" };

  const dup = await prisma.flow.findFirst({
    where: { projectId, name },
    select: { id: true },
  });
  if (dup) return { ok: false, reason: "name already exists", name };

  // Minimal validation: nodes + edges arrays, with at least a start node.
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : null;
  const edges = Array.isArray(raw.edges) ? raw.edges : null;
  if (!nodes || nodes.length === 0) {
    return { ok: false, reason: "AI returned no flow nodes" };
  }
  if (!edges) {
    return { ok: false, reason: "AI returned no flow edges" };
  }

  const created = await prisma.flow.create({
    data: {
      projectId,
      name,
      description:
        typeof raw.description === "string" ? raw.description : null,
      nodes: nodes as Prisma.InputJsonValue,
      edges: edges as Prisma.InputJsonValue,
    },
  });
  return { ok: true, id: created.id, name };
}

// ---------------------------------------------------------------------------
// Phase runners
// ---------------------------------------------------------------------------

interface PhaseCtx {
  job: JobRow;
}

// Drives one AI-assist call for a phase: streams tokens to the in-memory bus,
// returns the final parsed payload. Cancellation aborts the underlying HTTP
// request via AbortController so we don't keep generating tokens after the
// user clicked Cancel.
const ORCH_DEBUG = process.env.BOOTSTRAP_BUS_DEBUG === "1";

async function callAiStreaming(
  jobId: string,
  step: BootstrapStep,
  phaseIndex: number,
  kind: AiAssistKind,
  prompt: string,
  providerId: string,
  model: string | null,
  extraContext: string | null,
  temperature: number | null,
  maxTokens: number | null,
): Promise<Record<string, unknown>> {
  const bus = getBus(jobId);
  const listenerCount = bus.listenerCount("token");
  if (ORCH_DEBUG) {
    // eslint-disable-next-line no-console
    console.log(
      `[bootstrap] callAiStreaming job=${jobId} step=${step} phase=${phaseIndex} listeners=${listenerCount}`,
    );
  }
  bus.emit("token", {
    step,
    phaseIndex,
    kind: "phase-start",
    meta: { prompt },
  });

  // Accumulate tokens in memory only — the SSE-connected client sees them
  // live via the in-memory bus. We persist the buffer to the row exactly
  // once, when the AI call completes (or errors), to keep DB chatter sane.
  // Tradeoff: refreshing mid-stream doesn't replay in-flight tokens; you'll
  // see the buffer of the last *completed* phase until the next phase ends.
  let accumulator = "";

  const abort = new AbortController();
  // Cancellation check while the stream is running. We poll every ~500ms; on
  // a flipped status we abort the fetch and bail out.
  const cancelPoll = setInterval(async () => {
    try {
      const row = await prisma.bootstrapJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (row?.status === "cancelled") abort.abort();
    } catch {
      // ignore — the orchestrator's own DB writes will surface failure.
    }
  }, 500);

  // Commits the accumulated text to the row once. Called from both the
  // success and error paths so a refreshed page sees what was generated for
  // the most recent phase. `meta` carries the final state so the panel can
  // render with the right icon.
  const commitBuffer = async (
    state: "done" | "error",
    errorMessage?: string,
  ) => {
    try {
      await prisma.bootstrapJob.update({
        where: { id: jobId },
        data: {
          currentPhaseBuffer: {
            step,
            phaseIndex,
            text: accumulator,
            state,
            ...(errorMessage ? { error: errorMessage } : {}),
          } as Prisma.InputJsonValue,
        },
      });
    } catch {
      // ignore — best-effort.
    }
  };

  try {
    const data = await aiAssistStream(
      {
        kind,
        prompt,
        providerId,
        model,
        extraContext,
        temperature,
        maxTokens,
      },
      (chunk) => {
        accumulator += chunk;
        bus.emit("token", {
          step,
          phaseIndex,
          kind: "delta",
          content: chunk,
        });
      },
      abort.signal,
    );
    bus.emit("token", { step, phaseIndex, kind: "phase-end" });
    await commitBuffer("done");
    return data;
  } catch (e) {
    const msg = (e as Error).message;
    bus.emit("token", {
      step,
      phaseIndex,
      kind: "phase-end",
      meta: { error: msg },
    });
    await commitBuffer("error", msg);
    // Distinguish abort from other errors: if cancelled, surface the
    // sentinel so the outer catch flips into the cancelled path.
    if (abort.signal.aborted) {
      throw new BootstrapCancelledError();
    }
    throw e;
  } finally {
    clearInterval(cancelPoll);
  }
}

async function runPhase(
  step: BootstrapStep,
  ctx: PhaseCtx,
  // Receives a callback that wraps callAiStreaming with the per-step kind.
  fn: (
    invoke: (prompt: string, extraContext?: string | null) => Promise<Record<string, unknown>>,
    hint: string,
    index: number,
  ) => Promise<{ ok: boolean; reason?: string; id?: string; name?: string }>,
  kind: AiAssistKind,
): Promise<void> {
  const hints = PHASE_HINTS[step];
  const target = TARGETS[step];
  await appendEvent(ctx.job.id, {
    step,
    kind: "step-start",
    payload: { target },
  });

  let inserted = 0;
  for (let i = 0; i < target; i++) {
    // Hard cancel check between AI calls.
    await assertNotCancelled(ctx.job.id);

    const hint = hints[i % hints.length];
    const invoke = (prompt: string, extraContext?: string | null) =>
      callAiStreaming(
        ctx.job.id,
        step,
        i,
        kind,
        prompt,
        ctx.job.providerId,
        ctx.job.model,
        extraContext ?? null,
        ctx.job.temperature,
        ctx.job.maxTokens,
      );
    try {
      const res = await fn(invoke, hint, i);
      if (res.ok) {
        inserted++;
        await bumpInserted(ctx.job.id, step);
        await appendEvent(ctx.job.id, {
          step,
          kind: "inserted",
          payload: { entityId: res.id, name: res.name, hint, index: i },
        });
      } else {
        await appendEvent(ctx.job.id, {
          step,
          kind: "skipped",
          payload: { reason: res.reason, name: res.name, hint, index: i },
        });
      }
    } catch (e) {
      if (e instanceof BootstrapCancelledError) {
        throw e;
      }
      const msg = (e as Error).message;
      await appendEvent(ctx.job.id, {
        step,
        kind: "step-error",
        payload: { error: msg, hint, index: i },
      });
    }
  }

  await appendEvent(ctx.job.id, {
    step,
    kind: "step-done",
    payload: { inserted, attempted: target },
  });
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function runBootstrap(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!job) return;

  await prisma.bootstrapJob.update({
    where: { id: jobId },
    data: { status: "running", startedAt: new Date(), currentStep: "init" },
  });
  await appendEvent(jobId, {
    step: "init",
    kind: "step-start",
    payload: { prompt: job.prompt },
  });

  try {
    const ctx: PhaseCtx = { job };

    // --- Taxonomy -----------------------------------------------------------
    // Taxonomy doesn't fit the standard runPhase shape: the AI's taxonomy-node
    // kind returns `{ names: [...] }` (a list of 3–8 nodes per call), not one
    // entity per call. We run a small number of AI calls and iterate the
    // returned names, inserting each. Pass already-inserted names back as
    // extraContext so subsequent calls don't duplicate.
    let taxonomyId: string | null = null;
    if (job.scope.taxonomy) {
      await prisma.bootstrapJob.update({
        where: { id: jobId },
        data: { currentStep: "taxonomy" },
      });
      taxonomyId = await ensureTaxonomy(job.projectId);

      const TAX_CALLS = 2;
      const TAX_HINTS = [
        "the project's main topic areas",
        "complementary edge cases and less-obvious sub-topics",
      ];
      const insertedNames: string[] = [];
      let taxInserted = 0;

      await appendEvent(jobId, {
        step: "taxonomy",
        kind: "step-start",
        payload: { target: TAX_CALLS, mode: "names-array" },
      });

      for (let i = 0; i < TAX_CALLS; i++) {
        await assertNotCancelled(jobId);
        const hint = TAX_HINTS[i % TAX_HINTS.length];
        const extraContext =
          insertedNames.length > 0
            ? `Existing nodes (DO NOT duplicate):\n${insertedNames.map((n) => `- ${n}`).join("\n")}`
            : null;

        try {
          const data = await callAiStreaming(
            jobId,
            "taxonomy",
            i,
            KIND_FOR_STEP.taxonomy!,
            `${job.prompt} — ${hint}`,
            job.providerId,
            job.model,
            extraContext,
            job.temperature,
            job.maxTokens,
          );
          // Tolerate both shapes: the new `names: [...]` schema and the older
          // singular `name: "..."` in case the Python service changes.
          const rawNames: unknown[] = Array.isArray(data.names)
            ? (data.names as unknown[])
            : typeof data.name === "string"
              ? [data.name]
              : [];
          for (const raw of rawNames) {
            await assertNotCancelled(jobId);
            const name = typeof raw === "string" ? raw.trim() : "";
            if (!name) continue;
            const res = await insertTaxonomyNode(job.projectId, taxonomyId!, {
              name,
            });
            if (res.ok) {
              taxInserted++;
              insertedNames.push(name);
              await bumpInserted(jobId, "taxonomy");
              await appendEvent(jobId, {
                step: "taxonomy",
                kind: "inserted",
                payload: { entityId: res.id, name: res.name, callIndex: i },
              });
            } else {
              await appendEvent(jobId, {
                step: "taxonomy",
                kind: "skipped",
                payload: {
                  reason: res.reason,
                  name: res.name ?? name,
                  callIndex: i,
                },
              });
            }
          }
        } catch (e) {
          if (e instanceof BootstrapCancelledError) throw e;
          await appendEvent(jobId, {
            step: "taxonomy",
            kind: "step-error",
            payload: { error: (e as Error).message, callIndex: i },
          });
        }
      }

      await appendEvent(jobId, {
        step: "taxonomy",
        kind: "step-done",
        payload: { inserted: taxInserted, attempted: TAX_CALLS },
      });
    }

    // --- Languages ----------------------------------------------------------
    let langIds: string[] = [];
    if (job.scope.languages) {
      await prisma.bootstrapJob.update({
        where: { id: jobId },
        data: { currentStep: "languages" },
      });
      await runPhase(
        "languages",
        ctx,
        async (invoke, hint) => {
          const data = await invoke(`${job.prompt} — language profile, ${hint}`);
          const out = await insertLanguageProfile(job.projectId, data);
          if (out.ok && out.id) langIds.push(out.id);
          return out;
        },
        KIND_FOR_STEP.languages!,
      );
    } else {
      const existing = await prisma.languageProfile.findMany({
        where: { projectId: job.projectId },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      langIds = existing.map((p) => p.id);
    }

    // --- Personas -----------------------------------------------------------
    if (job.scope.personas) {
      await prisma.bootstrapJob.update({
        where: { id: jobId },
        data: { currentStep: "personas" },
      });
      await runPhase(
        "personas",
        ctx,
        async (invoke, hint) => {
          const data = await invoke(`${job.prompt} — persona, ${hint}`);
          return insertPersona(job.projectId, data, langIds);
        },
        KIND_FOR_STEP.personas!,
      );
    }

    // --- Templates ----------------------------------------------------------
    if (job.scope.templates) {
      await prisma.bootstrapJob.update({
        where: { id: jobId },
        data: { currentStep: "templates" },
      });
      await runPhase(
        "templates",
        ctx,
        async (invoke, hint) => {
          const data = await invoke(`${job.prompt} — ${hint}`);
          return insertTemplate(job.projectId, data);
        },
        KIND_FOR_STEP.templates!,
      );
    }

    // --- Tools --------------------------------------------------------------
    let catalogId: string | null = null;
    if (job.scope.tools) {
      await prisma.bootstrapJob.update({
        where: { id: jobId },
        data: { currentStep: "tools" },
      });
      catalogId = await ensureDefaultCatalog(job.projectId);
      await runPhase(
        "tools",
        ctx,
        async (invoke, hint) => {
          const data = await invoke(`${job.prompt} — ${hint}`);
          return insertToolDef(job.projectId, catalogId!, data);
        },
        KIND_FOR_STEP.tools!,
      );
    }

    // --- Flows --------------------------------------------------------------
    if (job.scope.flows) {
      await prisma.bootstrapJob.update({
        where: { id: jobId },
        data: { currentStep: "flows" },
      });
      // Provide existing tool/template catalog as extra context for the flow.
      const [tools, tmpls] = await Promise.all([
        prisma.toolDef.findMany({
          where: { catalog: { projectId: job.projectId } },
          select: { name: true, description: true },
          orderBy: { name: "asc" },
        }),
        prisma.promptTemplate.findMany({
          where: { projectId: job.projectId },
          select: { name: true, kind: true },
          orderBy: { name: "asc" },
        }),
      ]);
      const flowExtraContext = [
        tools.length > 0
          ? `Available tools in this project:\n${tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}`
          : null,
        tmpls.length > 0
          ? `Available templates in this project:\n${tmpls.map((t) => `- ${t.name} (${t.kind})`).join("\n")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n\n") || null;

      await runPhase(
        "flows",
        ctx,
        async (invoke, hint) => {
          const data = await invoke(`${job.prompt} — ${hint}`, flowExtraContext);
          return insertFlow(job.projectId, data);
        },
        KIND_FOR_STEP.flows!,
      );
    }

    // --- Rubrics ------------------------------------------------------------
    let rubricIds: string[] = [];
    if (job.scope.rubrics) {
      await prisma.bootstrapJob.update({
        where: { id: jobId },
        data: { currentStep: "rubrics" },
      });
      await runPhase(
        "rubrics",
        ctx,
        async (invoke, hint) => {
          const data = await invoke(`${job.prompt} — ${hint}`);
          const out = await insertRubric(job.projectId, job.createdById, data);
          if (out.ok && out.id) rubricIds.push(out.id);
          return out;
        },
        KIND_FOR_STEP.rubrics!,
      );
    } else {
      const existing = await prisma.rubric.findMany({
        where: { projectId: job.projectId },
        select: { id: true },
        orderBy: [{ isPreset: "desc" }, { createdAt: "asc" }],
      });
      rubricIds = existing.map((r) => r.id);
    }

    // --- Benchmarks ---------------------------------------------------------
    // Not AI-generated: we create a single chat-replay benchmark wired to the
    // first available rubric, since benchmark "shape" is mostly config.
    if (job.scope.benchmarks) {
      await prisma.bootstrapJob.update({
        where: { id: jobId },
        data: { currentStep: "benchmarks" },
      });
      await appendEvent(jobId, {
        step: "benchmarks",
        kind: "step-start",
        payload: { target: 1 },
      });
      try {
        const benchName = "Default chat-replay";
        const benchDesc =
          "Auto-generated by bootstrap. Replays accepted project conversations against a candidate model and scores with the default rubric.";
        const res = await insertBenchmark(
          job.projectId,
          job.createdById,
          rubricIds[0] ?? null,
          benchName,
          benchDesc,
        );
        if (res.ok) {
          await bumpInserted(jobId, "benchmarks");
          await appendEvent(jobId, {
            step: "benchmarks",
            kind: "inserted",
            payload: { entityId: res.id, name: res.name },
          });
        } else {
          await appendEvent(jobId, {
            step: "benchmarks",
            kind: "skipped",
            payload: { reason: res.reason, name: res.name },
          });
        }
      } catch (e) {
        await appendEvent(jobId, {
          step: "benchmarks",
          kind: "step-error",
          payload: { error: (e as Error).message },
        });
      }
      await appendEvent(jobId, {
        step: "benchmarks",
        kind: "step-done",
        payload: { inserted: rubricIds[0] ? 1 : 0, attempted: 1 },
      });
    }

    await prisma.bootstrapJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        currentStep: null,
        completedAt: new Date(),
      },
    });
    await appendEvent(jobId, { step: "done", kind: "done" });
  } catch (e) {
    if (e instanceof BootstrapCancelledError) {
      // Status was already flipped to "cancelled" by the user; just emit the
      // terminal event so the SSE stream closes cleanly.
      await prisma.bootstrapJob.update({
        where: { id: jobId },
        data: { currentStep: null, completedAt: new Date() },
      });
      await appendEvent(jobId, {
        step: "done",
        kind: "done",
        payload: { cancelled: true },
      });
    } else {
      const msg = (e as Error).message ?? String(e);
      await prisma.bootstrapJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          currentStep: null,
          completedAt: new Date(),
          error: msg,
        },
      });
      await appendEvent(jobId, {
        step: "done",
        kind: "error",
        payload: { error: msg },
      });
    }
  } finally {
    // Token bus is meaningless once the job is terminal; drop listeners and
    // free the entry to keep the global map bounded.
    releaseBus(jobId);
  }
}
