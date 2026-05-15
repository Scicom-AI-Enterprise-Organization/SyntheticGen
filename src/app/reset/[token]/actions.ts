"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

const RESET_TOKEN_PREFIX = "pwd-reset:";

const schema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export async function completePasswordReset(input: { token: string; newPassword: string }) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const record = await prisma.verificationToken.findUnique({
    where: { token: parsed.data.token },
  });
  if (!record || !record.identifier.startsWith(RESET_TOKEN_PREFIX)) {
    return { error: "Invalid reset link" };
  }
  if (record.expires < new Date()) {
    return { error: "Reset link expired" };
  }

  const userId = record.identifier.slice(RESET_TOKEN_PREFIX.length);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) return { error: "Account not found" };
  if (!user.passwordHash) {
    return { error: "This account signs in via SSO; reset on the provider instead." };
  }

  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash },
    }),
    prisma.verificationToken.delete({ where: { token: parsed.data.token } }),
  ]);

  return { ok: true as const };
}
