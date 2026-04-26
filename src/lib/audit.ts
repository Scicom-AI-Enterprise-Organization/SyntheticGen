import { headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export async function logAudit(input: {
  projectId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}) {
  let actorIp: string | null = null;
  try {
    const h = await headers();
    actorIp =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  } catch {
    // headers() is only available in request-scoped contexts; ignore otherwise.
  }
  await prisma.auditLogEntry
    .create({
      data: {
        projectId: input.projectId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorIp,
        action: input.action,
        targetKind: input.targetKind ?? null,
        targetId: input.targetId ?? null,
        metadata: input.metadata ?? undefined,
      },
    })
    .catch((e) => {
      console.error("[audit] failed:", e.message);
    });
}
