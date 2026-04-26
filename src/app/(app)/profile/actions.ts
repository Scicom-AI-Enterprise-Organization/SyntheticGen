"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";

const nameSchema = z.object({ name: z.string().trim().max(100) });

export async function updateProfile(formData: FormData) {
  const user = await requireUser();
  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: "Invalid name" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { name: parsed.data.name || null },
  });

  revalidatePath("/profile");
  return { ok: true };
}

const passwordSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function updatePassword(formData: FormData) {
  const sessionUser = await requireUser();
  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword") ?? undefined,
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: { passwordHash: true },
  });

  if (dbUser.passwordHash) {
    if (!parsed.data.currentPassword) {
      return { error: "Current password is required" };
    }
    const ok = await bcrypt.compare(parsed.data.currentPassword, dbUser.passwordHash);
    if (!ok) return { error: "Current password is incorrect" };
  }

  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({
    where: { id: sessionUser.id },
    data: { passwordHash: hash },
  });

  return { ok: true };
}
