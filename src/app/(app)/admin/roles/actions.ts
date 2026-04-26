"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";

export async function setRolePermissions(roleId: string, permissionKeys: string[]) {
  await requirePermission("roles:write");

  const perms = await prisma.permission.findMany({
    where: { key: { in: permissionKeys } },
  });

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId, permissionId: p.id })),
      skipDuplicates: true,
    }),
  ]);

  revalidatePath("/admin/roles");
}

export async function createRole(name: string) {
  await requirePermission("roles:write");
  await prisma.role.create({ data: { name } });
  revalidatePath("/admin/roles");
}

export async function deleteRole(roleId: string) {
  await requirePermission("roles:write");
  await prisma.role.delete({ where: { id: roleId } });
  revalidatePath("/admin/roles");
}
