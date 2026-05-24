"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import { tryCall } from "@/lib/synthgen-api";

// ───── Create ────────────────────────────────────────────────────────────────

const chatReplayFilterSchema = z.object({
  runIds: z.array(z.string()).optional(),
  personaIds: z.array(z.string()).optional(),
  taxonomyNodeIds: z.array(z.string()).optional(),
  statuses: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
  seed: z.number().int().optional(),
});

const createBenchmarkSchema = z.object({
  projectId: z.string(),
  // Only chat-replay is exposed from the UI. Kept as an explicit literal so
  // future kinds can extend this without silently changing default behaviour.
  kind: z.literal("project-chat-replay"),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
  mode: z.enum(["single-turn", "multi-turn"]),
  filter: chatReplayFilterSchema,
  defaultRubricId: z.string().optional().nullable(),
});

export async function createBenchmark(input: z.infer<typeof createBenchmarkSchema>) {
  const parsed = createBenchmarkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.write");

  // chat-replay: freeze the conversation snapshot at create time.
  const { projectId, filter, defaultRubricId } = parsed.data;
  const where: Prisma.ConversationWhereInput = { projectId };
  if (filter.runIds?.length) where.runId = { in: filter.runIds };
  if (filter.personaIds?.length) where.personaId = { in: filter.personaIds };
  if (filter.taxonomyNodeIds?.length) where.taxonomyNodeId = { in: filter.taxonomyNodeIds };
  if (filter.statuses?.length) where.status = { in: filter.statuses };
  else where.status = "accepted";

  const limit = filter.limit ?? 200;
  // Sample deterministically: order by (createdAt asc, id asc) then slice.
  // True random sampling would need a seed-based approach in SQL; for v1 the
  // user expresses preference via `limit` and the filter. They can re-create
  // the benchmark to re-sample.
  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, primaryLanguage: true },
  });
  if (conversations.length === 0) {
    return { error: "No conversations match the filter — adjust and try again." };
  }
  if (defaultRubricId) {
    const rubric = await prisma.rubric.findFirst({
      where: { id: defaultRubricId, projectId },
      select: { id: true },
    });
    if (!rubric) return { error: "Selected rubric not found in this project" };
  }

  const splits = Array.from(
    new Set(conversations.map((c) => c.primaryLanguage ?? "unknown")),
  ).sort();

  const created = await prisma.benchmark.create({
    data: {
      projectId,
      kind: "project-chat-replay",
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      source:
        filter.runIds?.length === 1
          ? `project-run:${filter.runIds[0]}`
          : "project-filter",
      splits,
      maxRowsPerSplit: null,
      config: {
        kind: "chat-replay",
        mode: parsed.data.mode,
        filter,
      } as unknown as Prisma.InputJsonValue,
      frozenConversationIds: conversations.map((c) => c.id),
      defaultRubricId: defaultRubricId ?? null,
      createdById: user.id,
    },
  });

  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "benchmark.create",
    targetKind: "Benchmark",
    targetId: created.id,
    metadata: {
      name: created.name,
      kind: "project-chat-replay",
      mode: parsed.data.mode,
      itemCount: conversations.length,
      rubricId: defaultRubricId ?? null,
    },
  });

  revalidatePath(`/projects/${projectId}/benchmarks`);
  return { ok: true, id: created.id };
}

// ───── Edit source ───────────────────────────────────────────────────────────

const editSourceSchema = z.object({
  projectId: z.string(),
  benchmarkId: z.string(),
  // Same filter shape as create — re-evaluates to a new frozen set.
  filter: chatReplayFilterSchema,
});

// Re-pick the source run / filter for an existing benchmark and re-freeze
// the conversation set. Useful when the original source run got deleted /
// reset, when new conversations have been accepted since, or when the
// user wants to change which run's conversations the benchmark replays.
//
// Caveat: existing BenchmarkRun rows (and their per-item BenchmarkResult
// rows) continue to reference the OLD conversation IDs. Some of those IDs
// may no longer be in the benchmark's new frozen set — past runs become
// historical snapshots of a stale conversation list. The UI surfaces this.
export async function editBenchmarkSource(input: z.infer<typeof editSourceSchema>) {
  const parsed = editSourceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.write");

  const { projectId, benchmarkId, filter } = parsed.data;

  const benchmark = await prisma.benchmark.findFirst({
    where: { id: benchmarkId, projectId },
    select: { id: true, kind: true, config: true },
  });
  if (!benchmark) return { error: "Benchmark not found" };
  if (benchmark.kind !== "project-chat-replay") {
    return { error: "Only project-chat-replay benchmarks have an editable source today" };
  }

  const where: Prisma.ConversationWhereInput = { projectId };
  if (filter.runIds?.length) where.runId = { in: filter.runIds };
  if (filter.personaIds?.length) where.personaId = { in: filter.personaIds };
  if (filter.taxonomyNodeIds?.length) where.taxonomyNodeId = { in: filter.taxonomyNodeIds };
  if (filter.statuses?.length) where.status = { in: filter.statuses };
  else where.status = "accepted";

  const limit = filter.limit ?? 200;
  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, primaryLanguage: true },
  });
  if (conversations.length === 0) {
    return { error: "No conversations match the new filter — adjust and try again." };
  }

  const splits = Array.from(
    new Set(conversations.map((c) => c.primaryLanguage ?? "unknown")),
  ).sort();

  // Preserve the existing config (mode, etc.) and just swap in the new filter.
  const prevConfig =
    (benchmark.config as { mode?: string; filter?: unknown } | null) ?? {};

  await prisma.benchmark.update({
    where: { id: benchmarkId },
    data: {
      source:
        filter.runIds?.length === 1
          ? `project-run:${filter.runIds[0]}`
          : "project-filter",
      splits,
      config: {
        ...prevConfig,
        kind: "chat-replay",
        filter,
      } as unknown as Prisma.InputJsonValue,
      frozenConversationIds: conversations.map((c) => c.id),
    },
  });

  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "benchmark.source.edit",
    targetKind: "Benchmark",
    targetId: benchmarkId,
    metadata: {
      newItemCount: conversations.length,
      runIds: filter.runIds ?? [],
    },
  });

  revalidatePath(`/projects/${projectId}/benchmarks/${benchmarkId}`);
  return { ok: true, itemCount: conversations.length };
}

// ───── Delete ────────────────────────────────────────────────────────────────

export async function deleteBenchmark(projectId: string, benchmarkId: string) {
  const { user } = await requireProjectPermission(projectId, "benchmarks.write");
  const b = await prisma.benchmark.findUnique({ where: { id: benchmarkId } });
  if (!b || b.projectId !== projectId) return { error: "Benchmark not found" };

  const liveRuns = await prisma.benchmarkRun.count({
    where: { benchmarkId, status: { in: ["queued", "running"] } },
  });
  if (liveRuns > 0) {
    return { error: `Cannot delete: ${liveRuns} run(s) still in flight. Cancel them first.` };
  }

  await prisma.benchmark.delete({ where: { id: benchmarkId } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "benchmark.delete",
    targetKind: "Benchmark",
    targetId: benchmarkId,
  });
  revalidatePath(`/projects/${projectId}/benchmarks`);
  return { ok: true };
}

// ───── Start run ─────────────────────────────────────────────────────────────

const startRunSchema = z.object({
  projectId: z.string(),
  benchmarkId: z.string(),
  // Candidate
  providerCredentialId: z.string(),
  model: z.string().min(1).max(120),
  // Chat-replay-only fields; ignored for hf-function-call benchmarks.
  judgeProviderCredentialId: z.string().optional().nullable(),
  judgeModel: z.string().min(1).max(120).optional().nullable(),
  rubricId: z.string().optional().nullable(),
  mode: z.enum(["single-turn", "multi-turn"]).optional().nullable(),
  samplingParams: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      top_p: z.number().min(0).max(1).optional(),
      max_tokens: z.number().int().min(1).max(64000).optional(),
      seed: z.number().int().optional().nullable(),
      // Judge-side overrides for chat-replay benchmarks. Stored in the
      // same samplingParams JSON blob so the worker picks them up without
      // schema changes; if absent, the worker falls back to its own
      // judge defaults.
      judge_temperature: z.number().min(0).max(2).optional(),
      judge_max_tokens: z.number().int().min(1).max(64000).optional(),
      // "one-shot" scores the whole conversation in a single judge call;
      // "per-turn" calls the judge once per assistant turn and writes a
      // separate BenchmarkResult per turn. Defaults to "one-shot" if
      // omitted.
      judge_strategy: z.enum(["one-shot", "per-turn"]).optional(),
      // Total judge attempts before accepting a malformed response.
      // Default 3 (1 attempt + 2 retries). Each retry bumps temperature
      // slightly so we don't re-roll the same broken JSON.
      judge_max_retries: z.number().int().min(1).max(10).optional(),
      // Worker concurrency for this run — bounded asyncio.Semaphore.
      // Allowed 1..32 to keep upstream rate-limits sane.
      concurrency: z.number().int().min(1).max(32).optional(),
    })
    .optional()
    .nullable(),
});

export async function startBenchmarkRun(input: z.infer<typeof startRunSchema>) {
  const parsed = startRunSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.execute");

  const benchmark = await prisma.benchmark.findUnique({
    where: { id: parsed.data.benchmarkId },
    select: {
      id: true,
      projectId: true,
      kind: true,
      source: true,
      name: true,
      defaultRubricId: true,
      config: true,
    },
  });
  if (!benchmark || benchmark.projectId !== parsed.data.projectId) {
    return { error: "Benchmark not found" };
  }

  const provider = await prisma.providerCredential.findUnique({
    where: { id: parsed.data.providerCredentialId },
    select: { projectId: true },
  });
  if (!provider || provider.projectId !== parsed.data.projectId) {
    return { error: "Candidate provider not in this project" };
  }

  let mode: "function-call" | "single-turn" | "multi-turn" = "function-call";
  let judgeProviderCredentialId: string | null = null;
  let judgeModel: string | null = null;
  let rubricId: string | null = null;

  if (benchmark.kind === "project-chat-replay") {
    // Chat-replay needs a judge + rubric. Fall back to the benchmark's
    // configured defaults if the form didn't override them.
    const configMode =
      benchmark.config && typeof benchmark.config === "object" && "mode" in benchmark.config
        ? ((benchmark.config as { mode?: string }).mode ?? "single-turn")
        : "single-turn";
    mode =
      parsed.data.mode === "single-turn" || parsed.data.mode === "multi-turn"
        ? parsed.data.mode
        : (configMode === "multi-turn" ? "multi-turn" : "single-turn");

    if (!parsed.data.judgeProviderCredentialId || !parsed.data.judgeModel) {
      return { error: "Chat-replay benchmarks require a judge provider and model" };
    }
    const judgeProvider = await prisma.providerCredential.findUnique({
      where: { id: parsed.data.judgeProviderCredentialId },
      select: { projectId: true },
    });
    if (!judgeProvider || judgeProvider.projectId !== parsed.data.projectId) {
      return { error: "Judge provider not in this project" };
    }
    judgeProviderCredentialId = parsed.data.judgeProviderCredentialId;
    judgeModel = parsed.data.judgeModel;

    rubricId = parsed.data.rubricId ?? benchmark.defaultRubricId ?? null;
    if (!rubricId) {
      return { error: "No rubric selected and benchmark has no default rubric" };
    }
    const rubric = await prisma.rubric.findFirst({
      where: { id: rubricId, projectId: parsed.data.projectId },
      select: { id: true },
    });
    if (!rubric) return { error: "Rubric not found in this project" };
  }

  const run = await prisma.benchmarkRun.create({
    data: {
      benchmarkId: parsed.data.benchmarkId,
      providerCredentialId: parsed.data.providerCredentialId,
      model: parsed.data.model,
      mode,
      judgeProviderCredentialId,
      judgeModel,
      rubricId,
      samplingParams: parsed.data.samplingParams
        ? (parsed.data.samplingParams as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      status: "queued",
      createdById: user.id,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "benchmark.run.start",
    targetKind: "BenchmarkRun",
    targetId: run.id,
    metadata: {
      benchmarkId: benchmark.id,
      benchmarkName: benchmark.name,
      model: parsed.data.model,
      mode,
      judgeModel,
      rubricId,
    },
  });

  await tryCall(
    () =>
      fetch(
        `${process.env.SYNTHGEN_API_URL ?? "http://localhost:8000"}/internal/benchmark-runs/${run.id}/start`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-token": process.env.SYNTHGEN_INTERNAL_TOKEN ?? "",
          },
          cache: "no-store",
        },
      ).then((r) => r.json()),
    `start benchmark run ${run.id}`,
  );

  revalidatePath(`/projects/${parsed.data.projectId}/benchmarks/${parsed.data.benchmarkId}`);
  return { ok: true, runId: run.id };
}

// ───── Export top-K% to labeling platform ────────────────────────────────────

const labelingExportSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
  // Labeling platform connection — both optional. When omitted, the
  // server falls back to the values stored in Project.labelingBaseUrl
  // and Project.labelingApiKeyEnc.
  labelingBaseUrl: z.string().url().optional(),
  labelingToken: z.string().min(10).optional(),
  // What percentage of conversations to export, e.g. 0.01 = top 1%.
  percent: z.number().min(0.001).max(1).default(0.01),
  // Optional override for the labeling project name; defaults to
  // "<benchmark name> · top <pct>% · <date>".
  labelingProjectName: z.string().min(2).max(120).optional(),
  // Minimum per-axis floor (1-N scale). Any conversation with ANY axis
  // below this is dropped. Default 4 — only top-2-tier results.
  minAxisScore: z.number().min(1).max(10).default(4),
});

// Helper: parse a JSONB field that might be a Prisma object or a JSON
// string (legacy rows).
function parseJsonbField<T = Record<string, unknown>>(raw: unknown): T | null {
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === "object") return p as T;
    } catch {
      return null;
    }
  } else if (raw && typeof raw === "object") {
    return raw as T;
  }
  return null;
}

// Pick the top-K% of conversations from a benchmark run, stratified by
// (split × persona × taxonomy node) to preserve diversity, then upload
// them as tasks to a `human_mos` project on the labeling platform.
//
// Selection algorithm:
//   1. Drop rows with verdict != "pass" OR any axis below `minAxisScore`.
//   2. Compute a composite quality score per row (mean of axis scores).
//   3. Group by (split, personaId, taxonomyNodeId) cells.
//   4. Round-robin pick the highest-scoring row from each cell until we
//      hit the target count (`ceil(totalPass * percent)`).
//   5. Inside each cell, items are sorted score-desc so the best
//      example from each (persona × topic × language) combo is picked
//      first — gives broad coverage even if one persona dominates.
//   6. Hash-dedupe via Conversation.dedupHash (already populated by the
//      worker on persist).
//
// The labeling project is created with rubric axes mapped 1:1 from the
// benchmark's rubric so the annotator's MOS scale matches the judge's.
export async function exportToLabelingPlatform(
  input: z.infer<typeof labelingExportSchema>,
) {
  const parsed = labelingExportSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.execute");

  const run = await prisma.benchmarkRun.findFirst({
    where: { id: parsed.data.runId, benchmark: { projectId: parsed.data.projectId } },
    include: {
      benchmark: { select: { id: true, name: true } },
      rubric: { select: { id: true, axes: true } },
    },
  });
  if (!run) return { error: "Benchmark run not found" };
  if (run.status !== "completed") {
    return { error: `Run is ${run.status}; export requires status='completed'.` };
  }

  // Resolve labeling base URL + token from the project settings when
  // the caller didn't pass overrides. The encrypted token blob is
  // decrypted here, never sent to the client.
  let labelingBaseUrl: string | undefined = parsed.data.labelingBaseUrl;
  let labelingToken: string | undefined = parsed.data.labelingToken;
  if (!labelingBaseUrl || !labelingToken) {
    const projectRow = await prisma.project.findUnique({
      where: { id: parsed.data.projectId },
      select: { labelingBaseUrl: true, labelingApiKeyEnc: true },
    });
    if (!labelingBaseUrl) labelingBaseUrl = projectRow?.labelingBaseUrl ?? undefined;
    if (!labelingToken && projectRow?.labelingApiKeyEnc) {
      const { decryptSecret } = await import("@/lib/crypto");
      labelingToken = decryptSecret(projectRow.labelingApiKeyEnc as unknown as Buffer);
    }
  }
  if (!labelingBaseUrl) {
    return { error: "Labeling platform base URL not configured (Settings → Labeling platform)." };
  }
  if (!labelingToken) {
    return { error: "Labeling platform API token not configured (Settings → Labeling platform)." };
  }

  // Pull conversation-level rows only (drop per-turn detail rows so each
  // task is one logical conversation).
  const results = await prisma.benchmarkResult.findMany({
    where: { runId: run.id, kind: "chat-replay" },
    select: {
      conversationId: true,
      judgeVerdict: true,
      judgeScores: true,
      judgeRationale: true,
      candidateMessages: true,
      split: true,
    },
  });

  // Rubric axes drive both the score floor + the labeling axes.
  type RubricAxis = { key: string; name?: string; scale?: number };
  const rubricAxes = (run.rubric?.axes as RubricAxis[] | null) ?? [];
  if (rubricAxes.length === 0) {
    return { error: "Run's rubric has no axes — nothing to map to MOS." };
  }

  // Filter + score. We DELIBERATELY don't filter by judgeVerdict —
  // with the strict judge prompt very few rows actually earn "pass"
  // (most land on "warn" since the prompt awards "pass" only when
  // every axis is in the top 20%). The axis floor is the real quality
  // gate; verdict is just a coarse summary the user can ignore for
  // export purposes.
  type Candidate = {
    conversationId: string;
    score: number;
    minAxis: number;
    verdict: string;
    split: string;
    candidateMessages: unknown;
    judgeRationale: string;
  };
  const candidates: Candidate[] = [];
  for (const r of results) {
    if (!r.conversationId) continue;
    const scores = parseJsonbField<Record<string, number>>(r.judgeScores);
    if (!scores) continue;
    let sum = 0;
    let count = 0;
    let minAxis = Infinity;
    for (const ax of rubricAxes) {
      const v = scores[ax.key];
      if (typeof v !== "number") continue;
      sum += v;
      count += 1;
      if (v < minAxis) minAxis = v;
    }
    if (count === 0) continue;
    if (minAxis < parsed.data.minAxisScore) continue;
    // We exclude verdict="fail" rows entirely — those are explicit
    // model failures and shouldn't reach human review even at low
    // floors.
    if (r.judgeVerdict === "fail") continue;
    candidates.push({
      conversationId: r.conversationId,
      score: sum / count,
      minAxis,
      verdict: r.judgeVerdict ?? "",
      split: r.split ?? "unknown",
      candidateMessages: r.candidateMessages,
      judgeRationale: r.judgeRationale ?? "",
    });
  }
  if (candidates.length === 0) {
    // Help the user pick a workable floor: report the verdict breakdown
    // and the actual axis-min distribution across rows.
    const minDistribution = new Map<number, number>();
    const verdictCounts: Record<string, number> = {};
    let totalScored = 0;
    for (const r of results) {
      const v = r.judgeVerdict ?? "(none)";
      verdictCounts[v] = (verdictCounts[v] ?? 0) + 1;
      const scores = parseJsonbField<Record<string, number>>(r.judgeScores);
      if (!scores) continue;
      let m = Infinity;
      for (const ax of rubricAxes) {
        const val = scores[ax.key];
        if (typeof val !== "number") continue;
        if (val < m) m = val;
      }
      if (m !== Infinity) {
        totalScored++;
        // Round to 1 decimal so the histogram is readable
        // (per-turn averaging produces fractional minAxis values).
        const bucket = Math.round(m * 10) / 10;
        minDistribution.set(bucket, (minDistribution.get(bucket) ?? 0) + 1);
      }
    }
    const dist = Array.from(minDistribution.entries())
      .sort(([a], [b]) => b - a)
      .map(([score, n]) => `${score}: ${n}`)
      .join(", ");
    const verdictSummary = Object.entries(verdictCounts)
      .map(([v, n]) => `${v}=${n}`)
      .join(", ");
    return {
      error:
        `No conversations passed the floor (minAxisScore=${parsed.data.minAxisScore}). ` +
        `Of ${results.length} rows: verdict { ${verdictSummary} }, ${totalScored} have scores. ` +
        `Min-axis distribution (rounded): ${dist || "(none)"}. ` +
        `Destination: ${labelingBaseUrl}. ` +
        `Lower minAxisScore or improve the run.`,
    };
  }

  // Load conversation metadata for stratification + dedup.
  const convIds = candidates.map((c) => c.conversationId);
  const convs = await prisma.conversation.findMany({
    where: { id: { in: convIds } },
    select: {
      id: true,
      personaId: true,
      taxonomyNodeId: true,
      primaryLanguage: true,
      dedupHash: true,
    },
  });
  const convMeta = new Map(convs.map((c) => [c.id, c]));

  // 3: group by (split, personaId, taxonomyNodeId).
  const cells = new Map<string, Candidate[]>();
  const seenHashes = new Set<string>();
  for (const c of candidates) {
    const meta = convMeta.get(c.conversationId);
    if (!meta) continue;
    // Dedup: skip if we've already kept a conversation with the same content hash.
    if (meta.dedupHash) {
      if (seenHashes.has(meta.dedupHash)) continue;
      seenHashes.add(meta.dedupHash);
    }
    const cellKey = `${c.split}|${meta.personaId ?? "_"}|${meta.taxonomyNodeId ?? "_"}`;
    const list = cells.get(cellKey) ?? [];
    list.push(c);
    cells.set(cellKey, list);
  }
  for (const list of cells.values()) {
    list.sort((a, b) => b.score - a.score);
  }

  // 4+5: round-robin from cells (best of each cell first, second-best,
  // etc.) until we hit the target count.
  const target = Math.max(1, Math.ceil(candidates.length * parsed.data.percent));
  const picked: Candidate[] = [];
  const cellLists = Array.from(cells.values());
  let cursor = 0;
  while (picked.length < target && cellLists.some((l) => l.length > cursor)) {
    for (const list of cellLists) {
      if (picked.length >= target) break;
      if (list.length > cursor) picked.push(list[cursor]);
    }
    cursor += 1;
  }

  if (picked.length === 0) {
    return { error: "Stratified sampling picked 0 conversations — try a larger percent or lower minAxisScore." };
  }

  // 6: build the labeling-platform payload.
  const labelingProjectName =
    parsed.data.labelingProjectName ??
    `${run.benchmark.name} · top ${Math.round(parsed.data.percent * 100)}% · ${new Date().toISOString().slice(0, 10)}`;

  // Create the labeling project (`human_mos` type).
  const createRes = await fetch(`${labelingBaseUrl.replace(/\/$/, "")}/api/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${labelingToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: labelingProjectName,
      description: `Top ${Math.round(parsed.data.percent * 100)}% of ${run.benchmark.name} (BenchmarkRun ${run.id.slice(0, 12)}). Auto-exported for human MOS spot-check.`,
      type: "human_mos",
    }),
  });
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    return { error: `Labeling platform create-project failed: ${createRes.status} ${body.slice(0, 200)}` };
  }
  const createJson = (await createRes.json()) as { project?: { id?: string } };
  const labelingProjectId = createJson.project?.id;
  if (!labelingProjectId) {
    return { error: "Labeling platform create-project returned no project id" };
  }

  // Configure the project's MOS axes from the rubric. Use axis `name` if
  // present (human-readable), falling back to `key`.
  const axisLabels = rubricAxes.map((a) => a.name ?? a.key);
  const patchRes = await fetch(
    `${labelingBaseUrl.replace(/\/$/, "")}/api/projects/${labelingProjectId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${labelingToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mos_enabled: true,
        mos_axes: axisLabels,
      }),
    },
  );
  if (!patchRes.ok) {
    const body = await patchRes.text().catch(() => "");
    return { error: `Labeling platform configure-axes failed: ${patchRes.status} ${body.slice(0, 200)}` };
  }

  // Upload tasks. The platform expects OpenAI-style messages with the
  // last entry being the assistant turn to rate. We pull from the
  // candidateMessages field which the worker writes per benchmark row.
  type LabelTaskMessage = { role: string; content: string };
  type LabelTask = {
    human_mos_data: {
      messages: LabelTaskMessage[];
      model: string;
      metadata?: Record<string, unknown>;
    };
  };
  const candidateModel = run.model;
  const tasks: LabelTask[] = [];
  for (const p of picked) {
    let msgs: unknown = p.candidateMessages;
    if (typeof msgs === "string") {
      try {
        msgs = JSON.parse(msgs);
      } catch {
        msgs = null;
      }
    }
    if (!Array.isArray(msgs) || msgs.length === 0) continue;
    // Reduce to just role+content (the labeling platform doesn't need
    // _turn or tool_calls — those would only confuse the annotator UI).
    // Ensure the last message is `assistant` per the API requirement.
    const cleaned: LabelTaskMessage[] = [];
    for (const m of msgs as Array<Record<string, unknown>>) {
      if (!m || typeof m !== "object") continue;
      const role = String(m.role ?? "");
      if (!["system", "user", "assistant", "tool"].includes(role)) continue;
      cleaned.push({ role, content: String(m.content ?? "") });
    }
    // Make sure last entry is assistant; if it's not, drop trailing
    // non-assistant entries.
    while (cleaned.length > 0 && cleaned[cleaned.length - 1].role !== "assistant") {
      cleaned.pop();
    }
    if (cleaned.length === 0) continue;
    tasks.push({
      human_mos_data: {
        messages: cleaned,
        model: candidateModel,
        metadata: {
          benchmarkRunId: run.id,
          conversationId: p.conversationId,
          judgeRationale: p.judgeRationale,
          compositeScore: Number(p.score.toFixed(3)),
          minAxis: p.minAxis,
          split: p.split,
        },
      },
    });
  }

  if (tasks.length === 0) {
    return { error: "No valid tasks to upload (all picks had empty / malformed messages)." };
  }

  // Upload in batches of 100 so we don't hit any single-request limits.
  let imported = 0;
  for (let i = 0; i < tasks.length; i += 100) {
    const chunk = tasks.slice(i, i + 100);
    const upRes = await fetch(
      `${labelingBaseUrl.replace(/\/$/, "")}/api/projects/${labelingProjectId}/tasks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${labelingToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tasks: chunk }),
      },
    );
    if (!upRes.ok) {
      const body = await upRes.text().catch(() => "");
      return {
        error: `Labeling platform task upload failed at batch ${i / 100 + 1}: ${upRes.status} ${body.slice(0, 200)}`,
        partialImported: imported,
        labelingProjectId,
      };
    }
    const upJson = (await upRes.json().catch(() => ({}))) as { imported?: number };
    imported += upJson.imported ?? chunk.length;
  }

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "benchmark.export.labeling",
    targetKind: "BenchmarkRun",
    targetId: run.id,
    metadata: {
      labelingProjectId,
      labelingProjectName,
      pickedCount: picked.length,
      uploadedCount: imported,
      percent: parsed.data.percent,
      minAxisScore: parsed.data.minAxisScore,
      totalCandidates: candidates.length,
    },
  });

  return {
    ok: true,
    labelingProjectId,
    labelingProjectName,
    labelingProjectUrl: `${labelingBaseUrl.replace(/\/$/, "")}/dashboard/projects/${labelingProjectId}`,
    pickedCount: picked.length,
    uploadedCount: imported,
    totalPassing: candidates.length,
  };
}

// ───── Project-level ensemble judges (shared across all benchmarks) ──────────

const ensembleJudgesSchema = z.object({
  projectId: z.string(),
  judges: z
    .array(
      z.object({
        providerCredentialId: z.string(),
        model: z.string().min(1).max(120),
      }),
    )
    .max(8),
});

// Save the project's ensemble judge list. Reused by every benchmark in
// the project — configure once on the benchmarks list page, every
// run's "Re-judge with ensemble" reads from this list. Empty array
// disables the ensemble button across all runs.
export async function setProjectEnsembleJudges(
  input: z.infer<typeof ensembleJudgesSchema>,
) {
  const parsed = ensembleJudgesSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.write");

  if (parsed.data.judges.length > 0) {
    const providerIds = parsed.data.judges.map((j) => j.providerCredentialId);
    const providers = await prisma.providerCredential.findMany({
      where: { id: { in: providerIds }, projectId: parsed.data.projectId },
      select: { id: true },
    });
    const validIds = new Set(providers.map((p) => p.id));
    for (const j of parsed.data.judges) {
      if (!validIds.has(j.providerCredentialId)) {
        return { error: `Provider ${j.providerCredentialId} not in this project` };
      }
    }
  }

  await prisma.project.update({
    where: { id: parsed.data.projectId },
    data: {
      ensembleJudges: parsed.data.judges as unknown as Prisma.InputJsonValue,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "project.ensemble_judges.set",
    targetKind: "Project",
    targetId: parsed.data.projectId,
    metadata: {
      count: parsed.data.judges.length,
      models: parsed.data.judges.map((j) => j.model),
    },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/benchmarks`);
  return { ok: true };
}

// ───── Ensemble re-judge (Tier-3) ────────────────────────────────────────────

const ensembleSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
  filter: z
    .object({
      verdict: z.enum(["pass", "warn"]).optional(),
      topPercent: z.number().min(0.001).max(1).optional(),
      minAxisScore: z.number().min(1).max(10).optional(),
      conversationIds: z.array(z.string()).optional(),
    })
    .optional(),
  threshold: z.number().min(0).max(5).default(1.0),
});

// Dispatch a multi-judge ensemble re-judge over a subset of a completed
// benchmark run. The judges themselves are read from the parent
// Benchmark.ensembleJudges so the same ensemble config applies across
// every run of that benchmark — users configure it once on the
// benchmark detail page, then any completed run can be ensembled with
// just a filter + threshold. The Python api updates
// `BenchmarkResult.ensembleResult` in place; returns immediately.
export async function ensembleRejudge(input: z.infer<typeof ensembleSchema>) {
  const parsed = ensembleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "benchmarks.execute");

  // Confirm run + ownership, then pull judges from the PROJECT (shared
  // across every benchmark in the project — configured once on the
  // benchmarks list page).
  const run = await prisma.benchmarkRun.findFirst({
    where: { id: parsed.data.runId, benchmark: { projectId: parsed.data.projectId } },
    select: { id: true, status: true, benchmarkId: true },
  });
  if (!run) return { error: "Benchmark run not found" };
  if (run.status !== "completed") {
    return { error: `Run is ${run.status}; ensemble requires status='completed'.` };
  }

  const projectRow = await prisma.project.findUnique({
    where: { id: parsed.data.projectId },
    select: { ensembleJudges: true },
  });
  const rawJudges = projectRow?.ensembleJudges as unknown;
  const judges: Array<{ providerCredentialId: string; model: string }> = [];
  if (Array.isArray(rawJudges)) {
    for (const j of rawJudges) {
      if (
        j &&
        typeof j === "object" &&
        typeof (j as Record<string, unknown>).providerCredentialId === "string" &&
        typeof (j as Record<string, unknown>).model === "string"
      ) {
        judges.push({
          providerCredentialId: (j as { providerCredentialId: string }).providerCredentialId,
          model: (j as { model: string }).model,
        });
      }
    }
  }
  if (judges.length < 2) {
    return {
      error:
        "Configure at least 2 ensemble judges on the project first " +
        "(Benchmarks page → Ensemble judges card).",
    };
  }

  // Defence in depth: validate each judge's provider is still in-project.
  const providers = await prisma.providerCredential.findMany({
    where: {
      id: { in: judges.map((j) => j.providerCredentialId) },
      projectId: parsed.data.projectId,
    },
    select: { id: true },
  });
  const validIds = new Set(providers.map((p) => p.id));
  for (const j of judges) {
    if (!validIds.has(j.providerCredentialId)) {
      return { error: `Saved judge provider ${j.providerCredentialId} is no longer in this project — re-configure on the benchmark page.` };
    }
  }

  const apiUrl = process.env.SYNTHGEN_API_URL ?? "http://localhost:8000";
  const internalToken = process.env.SYNTHGEN_INTERNAL_TOKEN ?? "";
  const res = await fetch(
    `${apiUrl}/internal/benchmark-runs/${parsed.data.runId}/ensemble`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": internalToken,
      },
      body: JSON.stringify({
        judges,
        filter: parsed.data.filter ?? {},
        threshold: parsed.data.threshold,
      }),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { error: `Worker dispatch failed (HTTP ${res.status}): ${body.slice(0, 200)}` };
  }

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "benchmark.run.ensemble",
    targetKind: "BenchmarkRun",
    targetId: parsed.data.runId,
    metadata: {
      judgeCount: judges.length,
      judgeModels: judges.map((j) => j.model),
      filter: parsed.data.filter ?? {},
      threshold: parsed.data.threshold,
    },
  });

  revalidatePath(
    `/projects/${parsed.data.projectId}/benchmarks/${run.benchmarkId}/runs/${parsed.data.runId}`,
  );
  return { ok: true };
}

// ───── Cancel ────────────────────────────────────────────────────────────────

export async function cancelBenchmarkRun(projectId: string, runId: string) {
  const { user } = await requireProjectPermission(projectId, "benchmarks.cancel");
  await prisma.benchmarkRun.updateMany({
    where: { id: runId, status: { in: ["queued", "running"] } },
    data: { status: "cancelled", completedAt: new Date() },
  });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "benchmark.run.cancel",
    targetKind: "BenchmarkRun",
    targetId: runId,
  });
  revalidatePath(`/projects/${projectId}/benchmarks`);
  return { ok: true };
}

// ───── Restart ───────────────────────────────────────────────────────────────

// Reset a benchmark run back to queued and re-dispatch it. Useful when:
//   - status is "queued" but the worker never picked it up (lost dispatch,
//     api container reload between create + start).
//   - status is "running" but the worker died and the row is stuck.
//   - status is "failed" / "cancelled" and the user wants another go.
// Two modes via `mode`:
//   - "fresh" (default): wipe every BenchmarkResult row and re-judge
//     the whole frozen set from scratch. Best when prompts/judge changed.
//   - "resume": KEEP existing BenchmarkResult rows and only judge
//     conversations that haven't been judged yet. Idempotent — safe to
//     call repeatedly after a crash or a manual cancel. The worker's
//     `_process_one` skips rowIdx values it finds in BenchmarkResult.
export async function restartBenchmarkRun(
  projectId: string,
  runId: string,
  mode: "fresh" | "resume" = "fresh",
) {
  const { user } = await requireProjectPermission(projectId, "benchmarks.execute");

  const run = await prisma.benchmarkRun.findFirst({
    where: { id: runId, benchmark: { projectId } },
    select: { id: true, benchmarkId: true },
  });
  if (!run) return { error: "Benchmark run not found in this project" };

  if (mode === "fresh") {
    await prisma.$transaction(async (tx) => {
      // Clear per-item results so the rerun doesn't show stale verdicts
      // alongside the new ones.
      await tx.benchmarkResult.deleteMany({ where: { runId } });
      await tx.benchmarkRun.update({
        where: { id: runId },
        data: {
          status: "queued",
          startedAt: null,
          completedAt: null,
          lastError: null,
          completedTurns: 0,
          failedTurns: 0,
          totalTurns: 0,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          metrics: Prisma.JsonNull,
        },
      });
    });
  } else {
    // Resume — keep existing per-item rows. Reset only the run-level
    // status fields so the worker can pick it up again.
    await prisma.benchmarkRun.update({
      where: { id: runId },
      data: {
        status: "queued",
        completedAt: null,
        lastError: null,
      },
    });
  }

  await logAudit({
    projectId,
    actorUserId: user.id,
    action:
      mode === "fresh" ? "benchmark.run.restart" : "benchmark.run.resume",
    targetKind: "BenchmarkRun",
    targetId: runId,
  });

  const dispatch = await tryCall(
    () =>
      fetch(
        `${process.env.SYNTHGEN_API_URL ?? "http://localhost:8000"}/internal/benchmark-runs/${runId}/start`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-token": process.env.SYNTHGEN_INTERNAL_TOKEN ?? "",
          },
          cache: "no-store",
        },
      ),
    `restart benchmark run ${runId}`,
  );

  revalidatePath(`/projects/${projectId}/benchmarks/${run.benchmarkId}/runs/${runId}`);
  revalidatePath(`/projects/${projectId}/benchmarks/${run.benchmarkId}`);

  if (!dispatch || !dispatch.ok) {
    return {
      ok: true,
      runId,
      warning:
        "Run reset to queued, but worker dispatch failed (check that the api container is reachable). Click Restart again once the worker is up.",
    };
  }
  return { ok: true, runId };
}
