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

// GET /api/v1/projects/:projectId/providers/import
// List the org's global provider credentials so a caller can discover the id
// (or name) to import. The encrypted key is never returned. Gated on the same
// providers.manage project permission as the import itself.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "providers.manage");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const globals = await prisma.globalProviderCredential.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        kind: true,
        baseUrl: true,
        defaultModel: true,
        keyFingerprint: true,
      },
    });
    return Response.json({ globalProviders: globals });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}

// POST /api/v1/projects/:projectId/providers/import
// Deep-copy one or more GlobalProviderCredential rows into this project as
// fresh ProviderCredential rows (encrypted key + all settings cloned, so the
// project copy is independent). Mirrors the `importGlobalProviders` server
// action. Accepts `globalProviderIds` and/or `names` (resolved to ids).
const schema = z
  .object({
    globalProviderIds: z.array(z.string()).max(50).optional(),
    names: z.array(z.string()).max(50).optional(),
  })
  .refine((d) => (d.globalProviderIds?.length ?? 0) + (d.names?.length ?? 0) > 0, {
    message: "Provide globalProviderIds or names",
  });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const user = await requireUserFromRequest(req);
    const { projectId } = await params;
    const perm = await checkProjectPermission(user, projectId, "providers.manage");
    if (!perm.ok) return Response.json({ error: perm.reason }, { status: 403 });

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const globals = await prisma.globalProviderCredential.findMany({
      where: {
        archivedAt: null,
        OR: [
          ...(parsed.data.globalProviderIds?.length
            ? [{ id: { in: parsed.data.globalProviderIds } }]
            : []),
          ...(parsed.data.names?.length
            ? [{ name: { in: parsed.data.names } }]
            : []),
        ],
      },
    });
    if (globals.length === 0) {
      return Response.json(
        { error: "No matching global providers found" },
        { status: 404 },
      );
    }

    // Resolve project-local name collisions with " (imported)" suffixes so the
    // (projectId, name) unique constraint holds.
    const existingNames = new Set(
      (
        await prisma.providerCredential.findMany({
          where: { projectId },
          select: { name: true },
        })
      ).map((p) => p.name),
    );
    const uniqueName = (base: string): string => {
      if (!existingNames.has(base)) {
        existingNames.add(base);
        return base;
      }
      let i = 1;
      for (;;) {
        const candidate = i === 1 ? `${base} (imported)` : `${base} (imported ${i})`;
        if (!existingNames.has(candidate)) {
          existingNames.add(candidate);
          return candidate;
        }
        i++;
      }
    };

    const created: { id: string; name: string }[] = [];
    for (const g of globals) {
      const name = uniqueName(g.name);
      const row = await prisma.providerCredential.create({
        data: {
          projectId,
          name,
          kind: g.kind,
          baseUrl: g.baseUrl,
          encryptedApiKey: g.encryptedApiKey,
          keyFingerprint: g.keyFingerprint,
          defaultModel: g.defaultModel,
          headers: (g.headers as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          reasoningEffort: g.reasoningEffort,
          chatTemplateKwargs:
            (g.chatTemplateKwargs as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          sourceGlobalProviderId: g.id,
          createdById: user.id,
        },
        select: { id: true, name: true },
      });
      created.push(row);
    }

    await logAudit({
      projectId,
      actorUserId: user.id,
      action: "provider.import-global",
      targetKind: "ProviderCredential",
      targetId: created.map((c) => c.id).join(","),
      metadata: {
        imported: created.map((c) => c.name),
        sourceGlobalIds: globals.map((g) => g.id),
        viaApi: true,
      },
    });

    return Response.json({ ok: true, providers: created }, { status: 201 });
  } catch (e) {
    if (e instanceof ApiUnauthorizedError) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw e;
  }
}
