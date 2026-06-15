import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashApiToken } from "@/lib/api-keys";

export type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  roles: string[];
  permissions: string[];
};

// First tries the `Authorization: Bearer <token>` header so API clients and
// scripts authenticate the same way; falls back to the NextAuth session
// cookie for browser requests. This makes ANY server action / API route
// that uses `requireUser()` automatically support both — no per-route
// rewrite required.
export async function getCurrentUser(): Promise<SessionUser | null> {
  const bearer = await tryBearerUser();
  if (bearer) return bearer;
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

async function tryBearerUser(): Promise<SessionUser | null> {
  let token: string | null = null;
  try {
    const h = await headers();
    const v = h.get("authorization") ?? h.get("Authorization");
    if (v) {
      const m = /^Bearer\s+(\S+)/i.exec(v);
      if (m) token = m[1];
    }
  } catch {
    // `headers()` only works in a request scope; outside of one (e.g. a
    // worker script importing this module) there's no bearer to find.
    return null;
  }
  if (!token) return null;
  const hashed = hashApiToken(token);
  const key = await prisma.apiKey.findUnique({
    where: { hashedToken: hashed },
    include: { user: true },
  });
  if (!key || key.revokedAt) return null;
  // Fire-and-forget last-used touch.
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  const userRoles = await prisma.userRole.findMany({
    where: { userId: key.user.id },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });
  const roles = userRoles.map((ur) => ur.role.name);
  const permissions = Array.from(
    new Set(
      userRoles.flatMap((ur) =>
        ur.role.permissions.map((rp) => rp.permission.key),
      ),
    ),
  );
  return {
    id: key.user.id,
    email: key.user.email,
    name: key.user.name,
    roles,
    permissions,
  };
}

// Bearer-token-aware variant. API routes that want to accept BOTH a session
// cookie AND a personal access token (so scripts / agents can call them)
// should use this instead of `getCurrentUser`. Token is read from the
// `Authorization: Bearer <token>` header.
//
// Token resolution is sha256(raw) → `ApiKey.hashedToken` (unique index, O(1)).
// Revoked or expired tokens return null. On a successful match we touch
// `lastUsedAt` (fire-and-forget so a write failure doesn't block the call).
// Thin wrappers retained for clarity at v1 API route call sites — the
// underlying `getCurrentUser` is already bearer-aware (it reads from
// `next/headers`).
export async function getCurrentUserFromRequest(
  _req: Request,
): Promise<SessionUser | null> {
  return getCurrentUser();
}

export async function requireUserFromRequest(req: Request): Promise<SessionUser> {
  const user = await getCurrentUserFromRequest(req);
  if (!user) throw new ApiUnauthorizedError();
  return user;
}

export class ApiUnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "ApiUnauthorizedError";
  }
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
