import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// DELETE /api/api-keys/:id — soft-revoke a token owned by the caller. We
// keep the row (with revokedAt set) so audit logs and "last used at" history
// don't vanish. The bearer-auth middleware rejects any row with revokedAt
// set, so revocation takes effect immediately.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;
  const key = await prisma.apiKey.findFirst({
    where: { id, userId: user.id },
    select: { id: true, name: true, revokedAt: true },
  });
  if (!key) return Response.json({ error: "Not found" }, { status: 404 });
  if (key.revokedAt) return Response.json({ ok: true, already: true });
  await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  await logAudit({
    actorUserId: user.id,
    action: "apikey.revoke",
    targetKind: "ApiKey",
    targetId: id,
    metadata: { name: key.name },
  });
  return Response.json({ ok: true });
}
