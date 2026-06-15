import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { mintApiToken } from "@/lib/api-keys";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(80),
});

// GET /api/api-keys — list the caller's tokens. Never returns the raw secret;
// only the prefix + metadata. Revoked rows are filtered out.
export async function GET() {
  const user = await requireUser();
  const rows = await prisma.apiKey.findMany({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });
  return Response.json(rows);
}

// POST /api/api-keys — mint a new token. Returns `{ id, name, prefix, raw }`
// where `raw` is the secret to copy. The DB only persists sha256(raw); this
// is the only time the raw value leaves the server.
export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.errors[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const minted = mintApiToken();
  const created = await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: parsed.data.name.trim(),
      prefix: minted.prefix,
      hashedToken: minted.hashed,
    },
    select: { id: true, name: true, prefix: true, createdAt: true },
  });
  await logAudit({
    actorUserId: user.id,
    action: "apikey.create",
    targetKind: "ApiKey",
    targetId: created.id,
    metadata: { name: created.name, prefix: created.prefix },
  });
  return Response.json({ ...created, raw: minted.raw }, { status: 201 });
}
