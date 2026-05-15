"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";

const RESET_TOKEN_PREFIX = "pwd-reset:";
const RESET_TTL_HOURS = 24;

export async function setUserRoles(userId: string, roleNames: string[]) {
  await requirePermission("users:write");

  const roles = await prisma.role.findMany({ where: { name: { in: roleNames } } });
  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId } }),
    prisma.userRole.createMany({
      data: roles.map((r) => ({ userId, roleId: r.id })),
      skipDuplicates: true,
    }),
  ]);

  revalidatePath("/admin/organization");
}

export async function deleteUser(userId: string) {
  await requirePermission("users:delete");
  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin/organization");
}

// Issues a one-time password-reset link for the target user. The token is a
// VerificationToken keyed by `pwd-reset:<userId>` so the existing schema is
// reused. The link is returned ONCE to the caller; share it through a secure
// channel. Any previous unused reset tokens for the same user are wiped first
// so only one active reset exists at a time.
export async function resetUserPassword(userId: string) {
  await requirePermission("users:write");

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, email: true },
  });
  if (!target) return { error: "User not found" };
  if (!target.passwordHash) {
    return { error: "This user signs in via SSO; reset on the provider instead." };
  }

  const identifier = `${RESET_TOKEN_PREFIX}${userId}`;
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({
      data: { identifier, token, expires },
    }),
  ]);

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const baseUrl = process.env.AUTH_URL ?? `${proto}://${host}`;

  revalidatePath("/admin/organization");
  return {
    ok: true as const,
    link: `${baseUrl}/reset/${token}`,
    expiresAt: expires.toISOString(),
  };
}
