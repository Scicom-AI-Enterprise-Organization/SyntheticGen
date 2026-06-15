import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/v1/projects/:projectId/tools/bulk — import many OpenAI-shape tools
// in one call. Mirrors `bulkImportToolDefs`. `mode: "skip"` leaves same-name
// tools alone; `"overwrite"` replaces them (version bumped). Per-item outcomes
// are returned so one bad row doesn't abort the batch.
const schema = z.object({
  catalogId: z.string().optional().nullable(),
  mode: z.enum(["skip", "overwrite"]).default("skip"),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        parameters: z.record(z.string(), z.unknown()),
        stage: z.string().optional(),
        returns: z.string().optional(),
      }),
    )
    .min(1)
    .max(500),
});

async function resolveCatalogId(
  projectId: string,
  catalogId: string | null | undefined,
): Promise<string | null> {
  if (catalogId) {
    const c = await prisma.toolCatalog.findFirst({
      where: { id: catalogId, projectId },
      select: { id: true },
    });
    return c?.id ?? null;
  }
  const existing = await prisma.toolCatalog.findFirst({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.toolCatalog.create({
    data: { projectId, name: "Default", description: null },
  });
  return created.id;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "tools.write");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const catalogId = await resolveCatalogId(projectId, parsed.data.catalogId);
    if (!catalogId) {
      return Response.json(
        { error: "catalogId not found in this project" },
        { status: 400 },
      );
    }

    const existing = await prisma.toolDef.findMany({
      where: { catalogId },
      select: { id: true, name: true },
    });
    const existingByName = new Map(existing.map((t) => [t.name, t]));

    type ItemResult =
      | { ok: true; name: string; id: string; action: "created" | "updated" | "skipped" }
      | { ok: false; index: number; name: string | null; error: string };
    const results: ItemResult[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < parsed.data.tools.length; i++) {
      const it = parsed.data.tools[i];
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(it.name)) {
        results.push({
          ok: false,
          index: i,
          name: it.name,
          error: "name must be a snake_case identifier",
        });
        continue;
      }
      const localePresets: string[] = [];
      if (it.stage && it.stage.trim())
        localePresets.push(it.stage.trim().toLowerCase());
      let description = it.description;
      if (it.returns && it.returns.trim())
        description = `${it.description}\n\nReturns: ${it.returns.trim()}`;

      const dup = existingByName.get(it.name);
      try {
        if (dup && parsed.data.mode === "skip") {
          skipped += 1;
          results.push({ ok: true, name: it.name, id: dup.id, action: "skipped" });
        } else if (dup && parsed.data.mode === "overwrite") {
          const u = await prisma.toolDef.update({
            where: { id: dup.id },
            data: {
              description,
              parameters: it.parameters as Prisma.InputJsonValue,
              localePresets,
              version: { increment: 1 },
            },
            select: { id: true, name: true },
          });
          updated += 1;
          results.push({ ok: true, name: u.name, id: u.id, action: "updated" });
        } else {
          const c = await prisma.toolDef.create({
            data: {
              catalogId,
              name: it.name,
              description,
              parameters: it.parameters as Prisma.InputJsonValue,
              localePresets,
            },
            select: { id: true, name: true },
          });
          created += 1;
          results.push({ ok: true, name: c.name, id: c.id, action: "created" });
        }
      } catch (e) {
        results.push({ ok: false, index: i, name: it.name, error: (e as Error).message });
      }
    }

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "tool.bulk_import",
      targetKind: "ToolCatalog",
      targetId: catalogId,
      metadata: {
        total: parsed.data.tools.length,
        created,
        updated,
        skipped,
        failed: results.filter((r) => !r.ok).length,
        mode: parsed.data.mode,
        viaApi: true,
      },
    });

    return Response.json(
      {
        ok: true,
        total: parsed.data.tools.length,
        created,
        updated,
        skipped,
        failed: results.filter((r) => !r.ok).length,
        results,
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
