import { requirePermission } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UsersTable } from "./users-table";

export default async function AdminUsersPage() {
  await requirePermission("users:read");

  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: { roles: { include: { role: true } } },
    }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <p className="mt-2 text-muted-foreground">Manage users and role assignments.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            All users
            <Badge variant="secondary">{users.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UsersTable
            users={users.map((u) => ({
              id: u.id,
              email: u.email,
              name: u.name,
              roles: u.roles.map((ur) => ur.role.name),
            }))}
            allRoles={roles.map((r) => r.name)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
