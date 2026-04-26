import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  roles: string[];
  permissions: string[];
};

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    roles: session.user.roles ?? [],
    permissions: session.user.permissions ?? [],
  };
}

export function hasRole(user: SessionUser | null, role: string): boolean {
  return !!user?.roles.includes(role);
}

export function hasPermission(user: SessionUser | null, permission: string): boolean {
  return !!user?.permissions.includes(permission);
}

export function hasAnyPermission(user: SessionUser | null, perms: string[]): boolean {
  return !!user && perms.some((p) => user.permissions.includes(p));
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(role: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user, role)) redirect("/forbidden");
  return user;
}

export async function requirePermission(permission: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user, permission)) redirect("/forbidden");
  return user;
}
