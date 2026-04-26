"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";

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

  revalidatePath("/admin/users");
}

export async function deleteUser(userId: string) {
  await requirePermission("users:delete");
  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin/users");
}
