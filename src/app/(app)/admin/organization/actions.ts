"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";

const createSchema = z.object({
  email: z.string().email().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  roleName: z.string().optional().or(z.literal("")).transform((v) => (v ? v : undefined)),
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});

export async function createInvitation(input: {
  email?: string;
  roleName?: string;
  expiresInDays?: number;
}) {
  const inviter = await requirePermission("invites:write");
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };

  const { email, roleName, expiresInDays } = parsed.data;

  let roleId: string | null = null;
  if (roleName) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) return { error: `Unknown role: ${roleName}` };
    roleId = role.id;
  }

  const token = randomBytes(24).toString("base64url");
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  await prisma.invitation.create({
    data: {
      token,
      email: email ?? null,
      roleId,
      invitedById: inviter.id,
      expiresAt,
    },
  });

  revalidatePath("/admin/organization");
  return { ok: true, token };
}

export async function revokeInvitation(id: string) {
  await requirePermission("invites:write");
  await prisma.invitation.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  revalidatePath("/admin/organization");
}
