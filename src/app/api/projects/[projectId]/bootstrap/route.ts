// GET /api/projects/[projectId]/bootstrap
//
// Returns a JSON snapshot of the project's bootstrap activity so dashboards
// and external monitors can show progress without subscribing to the SSE
// stream:
//
//   {
//     current:  <BootstrapJobSummary | null>,   // live job, or most-recent if none live
//     recent:   <BootstrapJobSummary[]>         // up to 10 prior runs, newest first
//   }
//
// Each BootstrapJobSummary is the durable subset of the row that's safe to
// expose: status, scope, currentStep, per-step inserted counts, event count
// (NOT the full events array), error, timestamps. The full event log + token
// stream remain on /api/projects/[projectId]/bootstrap/[jobId]/stream.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function eventCountFrom(events: unknown): number {
  return Array.isArray(events) ? events.length : 0;
}

function insertedTotalFrom(inserted: unknown): number {
  if (!inserted || typeof inserted !== "object") return 0;
  let total = 0;
  for (const v of Object.values(inserted as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
}

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
    eventCount: eventCountFrom(row.events),
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "project.read");
  if (!perm.ok) {
    return Response.json({ error: perm.reason }, { status: 403 });
  }

  // Confirm project exists (a 404 here surfaces typo'd IDs cleanly).
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    return Response.json({ error: "project not found" }, { status: 404 });
  }

  const selectFields = {
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

  // "current" = live job (queued/running) if any, otherwise the most-recent
  // finished one so dashboard widgets always have *something* to render.
  const live = await prisma.bootstrapJob.findFirst({
    where: {
      projectId,
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
    select: selectFields,
  });
  const fallback = live
    ? null
    : await prisma.bootstrapJob.findFirst({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        select: selectFields,
      });
  const current = live ?? fallback;

  // "recent" = up to 10 finished jobs (terminal statuses), newest first.
  // If `current` came from `live`, the last finished one isn't duplicated;
  // if `current` came from `fallback`, the same row also appears in `recent`
  // which is fine — UIs can de-dupe by id.
  const recent = await prisma.bootstrapJob.findMany({
    where: {
      projectId,
      status: { in: ["completed", "failed", "cancelled"] },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: selectFields,
  });

  return Response.json({
    current: current ? toSummary(current) : null,
    recent: recent.map(toSummary),
  });
}
