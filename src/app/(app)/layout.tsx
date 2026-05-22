import { requireUser, hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { AppSidebar } from "@/components/auth/app-sidebar";
import { AppTopbar } from "@/components/auth/app-topbar";
import { SidebarStateProvider } from "@/components/auth/sidebar-state";
import { ConfirmDialogProvider } from "@/components/confirm-dialog";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.permissions.some((p) =>
    ["users:read", "roles:read"].includes(p),
  );

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
    <ConfirmDialogProvider>
      <SidebarStateProvider>
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
          <AppSidebar isAdmin={isAdmin} projects={projects} />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppTopbar projects={projects} />
            <main className="min-w-0 flex-1 overflow-y-auto px-4 pt-8 pb-4 lg:px-8">
              {children}
            </main>
          </div>
        </div>
      </SidebarStateProvider>
    </ConfirmDialogProvider>
  );
}
