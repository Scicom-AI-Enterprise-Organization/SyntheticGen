"use server";

import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

const schema = z.object({
  token: z.string().min(8),
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
});

export async function registerViaInvite(input: {
  token: string;
  email: string;
  name: string;
  password: string;
}) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const invite = await prisma.invitation.findUnique({
    where: { token: parsed.data.token },
  });
  if (!invite) return { error: "This invitation link is not recognized." };
  if (invite.revokedAt) return { error: "This invitation has been revoked." };
  if (invite.acceptedAt) return { error: "This invitation has already been used." };
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return { error: "This invitation has expired." };
  }

  const email = parsed.data.email.toLowerCase().trim();
  if (invite.email && invite.email.toLowerCase() !== email) {
    return {
      error: `This invite is bound to ${invite.email}. Use that email to register.`,
    };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return {
      error:
        "An account already exists for this email. Sign in instead — the invite will attach on next sign-in.",
    };
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: parsed.data.name.trim(),
        passwordHash,
      },
    });

    // Attach invite's role if present, otherwise fall back to the global "member" role.
    const roleId =
      invite.roleId ??
      (await tx.role.findUnique({ where: { name: "member" } }))?.id ??
      null;
    if (roleId) {
      await tx.userRole.create({
        data: { userId: user.id, roleId },
      });
    }

    await tx.invitation.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date(), acceptedById: user.id },
    });
  });

  return { ok: true };
}
