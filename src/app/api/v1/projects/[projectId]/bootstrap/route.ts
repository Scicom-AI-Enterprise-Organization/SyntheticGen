import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";
import {
  runBootstrap,
  STEP_ORDER,
  type BootstrapScope,
} from "@/app/(app)/projects/[projectId]/bootstrap/orchestrator";

export const runtime = "nodejs";

// The REST mirror of the in-app "Bootstrap" project-setup wizard. Lets an
// agent kick off the same taxonomy → languages → personas → templates → tools
// → flows → rubrics → benchmarks pipeline that the UI's start form fires, and
// poll its progress, using a personal `sgk_…` token instead of a session
// cookie. The heavy lifting still happens in the shared `runBootstrap`
// orchestrator — this route only validates input, enforces the same
// single-flight guard, and returns JSON.

interface BootstrapJobSummary {
  id: string;
  status: string;
  prompt: string;
  providerId: string;
  model: string | null;
  scope: Record<string, boolean>;
  currentStep: string | null;
  inserted: Record<string, number>;
  insertedTotal: number;
  eventCount: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

function insertedTotalFrom(inserted: unknown): number {
  if (!inserted || typeof inserted !== "object") return 0;
  let total = 0;
  for (const v of Object.values(inserted as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
}

const SUMMARY_SELECT = {
  id: true,
  status: true,
  prompt: true,
  providerId: true,
  model: true,
  scope: true,
  currentStep: true,
  inserted: true,
  events: true,
  error: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
} as const;

function toSummary(row: {
  id: string;
  status: string;
  prompt: string;
  providerId: string;
  model: string | null;
  scope: unknown;
  currentStep: string | null;
  inserted: unknown;
  events: unknown;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}): BootstrapJobSummary {
  return {
    id: row.id,
    status: row.status,
    prompt: row.prompt,
    providerId: row.providerId,
    model: row.model,
    scope: (row.scope as Record<string, boolean>) ?? {},
    currentStep: row.currentStep,
    inserted: (row.inserted as Record<string, number>) ?? {},
    insertedTotal: insertedTotalFrom(row.inserted),
    eventCount: Array.isArray(row.events) ? row.events.length : 0,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

// GET /api/v1/projects/:projectId/bootstrap
// Snapshot of the project's bootstrap activity: the live (or most-recent) job
// plus up to 10 finished ones, newest first. Mirrors the dashboard snapshot at
// /api/projects/:projectId/bootstrap but bearer-authenticated.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "project.read");
    if (!perm.ok) {
      return Response.json({ error: perm.reason }, { status: 403 });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      return Response.json({ error: "project not found" }, { status: 404 });
    }

    // "current" = a queued/running job if one exists, else the most-recent
    // finished one so a poller always has something to render.
    const live = await prisma.bootstrapJob.findFirst({
      where: { projectId, status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "desc" },
      select: SUMMARY_SELECT,
    });
    const fallback = live
      ? null
      : await prisma.bootstrapJob.findFirst({
          where: { projectId },
          orderBy: { createdAt: "desc" },
          select: SUMMARY_SELECT,
        });
    const current = live ?? fallback;

    const recent = await prisma.bootstrapJob.findMany({
      where: {
        projectId,
        status: { in: ["completed", "failed", "cancelled"] },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: SUMMARY_SELECT,
    });

    return Response.json({
      current: current ? toSummary(current) : null,
      recent: recent.map(toSummary),
    });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// POST /api/v1/projects/:projectId/bootstrap — create + start a bootstrap job.
// Mirrors the `startBootstrap` server action behind the UI's start form. Each
// `scope` key is optional; omit `scope` entirely to bootstrap everything.
const scopeSchema = z
  .object({
    taxonomy: z.boolean().optional(),
    languages: z.boolean().optional(),
    personas: z.boolean().optional(),
    templates: z.boolean().optional(),
    tools: z.boolean().optional(),
    flows: z.boolean().optional(),
    rubrics: z.boolean().optional(),
    benchmarks: z.boolean().optional(),
    useExistingToolsContext: z.boolean().optional(),
  })
  .strict();

const startSchema = z.object({
  prompt: z.string().min(8).max(4000),
  providerId: z.string().min(1),
  model: z.string().max(200).optional().nullable(),
  temperature: z.number().min(0).max(2).optional().nullable(),
  maxTokens: z.number().int().min(256).max(64000).optional().nullable(),
  scope: scopeSchema.optional(),
});

const ALL_STEPS = STEP_ORDER;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    // Same gate as the UI server action — bootstrap mutates project-wide
    // config, so it requires project.update (OWNER / global admin), not the
    // softer runs.execute.
    const perm = await checkProjectPermission(user, projectId, "project.update");
    if (!perm.ok) {
      return Response.json({ error: perm.reason }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = startSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const data = parsed.data;

    // Resolve the scope. No `scope` → bootstrap every phase. A partial scope
    // opts in to exactly the phases set true; everything else defaults false.
    const provided = data.scope;
    const scope: BootstrapScope = provided
      ? {
          taxonomy: provided.taxonomy ?? false,
          languages: provided.languages ?? false,
          personas: provided.personas ?? false,
          templates: provided.templates ?? false,
          tools: provided.tools ?? false,
          flows: provided.flows ?? false,
          rubrics: provided.rubrics ?? false,
          benchmarks: provided.benchmarks ?? false,
          useExistingToolsContext: provided.useExistingToolsContext ?? false,
        }
      : {
          taxonomy: true,
          languages: true,
          personas: true,
          templates: true,
          tools: true,
          flows: true,
          rubrics: true,
          benchmarks: true,
        };
    if (!ALL_STEPS.some((s) => scope[s])) {
      return Response.json(
        { error: "Pick at least one thing to bootstrap." },
        { status: 400 },
      );
    }

    // Provider must belong to this project.
    const provider = await prisma.providerCredential.findUnique({
      where: { id: data.providerId },
      select: { projectId: true },
    });
    if (!provider || provider.projectId !== projectId) {
      return Response.json(
        { error: "Provider not found in this project" },
        { status: 400 },
      );
    }

    // Single-flight guard: at most one queued/running bootstrap per project.
    const running = await prisma.bootstrapJob.findFirst({
      where: { projectId, status: { in: ["queued", "running"] } },
      select: { id: true },
    });
    if (running) {
      return Response.json(
        {
          error:
            "A bootstrap job is already running for this project. Wait for it to finish or cancel it first.",
          runningJobId: running.id,
        },
        { status: 409 },
      );
    }

    const created = await prisma.bootstrapJob.create({
      data: {
        projectId,
        prompt: data.prompt.trim(),
        providerId: data.providerId,
        model: data.model || null,
        temperature: data.temperature ?? null,
        maxTokens: data.maxTokens ?? null,
        scope: scope as unknown as Prisma.InputJsonValue,
        status: "queued",
        createdById: user.id,
      },
    });

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "bootstrap.create",
      targetKind: "BootstrapJob",
      targetId: created.id,
      metadata: { scope: scope as unknown as Prisma.InputJsonValue, viaApi: true },
    });

    // Fire-and-forget the orchestrator in this process (same as the server
    // action). Failures are captured onto the job row; poll GET
    // /bootstrap/:jobId for progress or subscribe to the SSE stream.
    void runBootstrap(created.id).catch((err) => {
      console.error("[bootstrap] orchestrator crashed:", err);
    });

    return Response.json(
      {
        ok: true,
        job: {
          id: created.id,
          status: "queued",
          scope,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
