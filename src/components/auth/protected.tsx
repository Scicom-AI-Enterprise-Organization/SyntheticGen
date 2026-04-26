import { getCurrentUser, hasPermission, hasRole } from "@/lib/rbac";

interface ProtectedProps {
  permission?: string;
  role?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Server component that renders children only if the current user has the
 * required permission/role. Renders nothing (or `fallback`) otherwise.
 */
export async function Protected({ permission, role, fallback = null, children }: ProtectedProps) {
  const user = await getCurrentUser();
  if (permission && !hasPermission(user, permission)) return <>{fallback}</>;
  if (role && !hasRole(user, role)) return <>{fallback}</>;
  if (!permission && !role && !user) return <>{fallback}</>;
  return <>{children}</>;
}
