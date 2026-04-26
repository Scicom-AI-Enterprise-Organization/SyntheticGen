import Link from "next/link";
import { requireUser, hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { AppSidebar } from "@/components/auth/app-sidebar";
import { UserMenu } from "@/components/auth/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.permissions.some((p) =>
    ["users:read", "roles:read"].includes(p),
  );

  // Pre-fetch the user's projects so the sidebar can resolve the active
  // project name from the pathname client-side without an extra round-trip.
  const isGlobalAdmin =
    hasPermission(user, "users:write") && hasPermission(user, "roles:write");
  const projects = await prisma.project.findMany({
    where: {
      archivedAt: null,
      ...(isGlobalAdmin ? {} : { members: { some: { userId: user.id } } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 lg:px-6">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
          SyntheticGen
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <AppSidebar isAdmin={isAdmin} projects={projects} />
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-8 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
