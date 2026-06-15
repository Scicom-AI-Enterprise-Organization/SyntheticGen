import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiUnauthorizedError,
  requireUserFromRequest,
} from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const schema = z.object({
  // Optional — when omitted we use (or create) the project's default catalog.
  // Lets agents create tools without first having to discover the catalogId.
  catalogId: z.string().optional().nullable(),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Use snake_case identifier (a-z, 0-9, _)"),
  description: z.string().min(1).max(2000),
  parameters: z.unknown(),
  localePresets: z.array(z.string()).default([]),
  mockSeed: z.unknown().optional(),
  mockResponseSchema: z.unknown().optional(),
});

async function resolveCatalogId(
  projectId: string,
  catalogId: string | null | undefined,
): Promise<string> {
  if (catalogId) return catalogId;
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "tools.read");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });
    const rows = await prisma.toolDef.findMany({
      where: { catalog: { projectId } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        catalogId: true,
        name: true,
        description: true,
        parameters: true,
        localePresets: true,
      },
    });
    return Response.json({ tools: rows });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
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
    const d = parsed.data;
    if (!d.parameters || typeof d.parameters !== "object") {
      return Response.json(
        { error: "parameters must be a JSON Schema object" },
        { status: 400 },
      );
    }
    const catalogId = await resolveCatalogId(projectId, d.catalogId);
    const created = await prisma.toolDef.create({
      data: {
        catalogId,
        name: d.name,
        description: d.description,
        parameters: d.parameters as object,
        localePresets: d.localePresets,
        mockSeed: (d.mockSeed as object | undefined) ?? undefined,
        mockResponseSchema:
          (d.mockResponseSchema as object | undefined) ?? undefined,
      },
    });
    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "tool.create",
      targetKind: "ToolDef",
      targetId: created.id,
      metadata: { name: created.name, catalogId, viaApi: true },
    });
    return Response.json({ ok: true, tool: created }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
