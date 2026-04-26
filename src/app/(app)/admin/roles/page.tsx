import { requirePermission } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RolesEditor } from "./roles-editor";

export default async function AdminRolesPage() {
  await requirePermission("roles:read");

  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({
      orderBy: { name: "asc" },
      include: { permissions: { include: { permission: true } } },
    }),
    prisma.permission.findMany({ orderBy: { key: "asc" } }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Roles &amp; Permissions</h1>
        <p className="mt-2 text-muted-foreground">
          Toggle which permissions each role grants.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>
        <CardContent>
          <RolesEditor
            roles={roles.map((r) => ({
              id: r.id,
              name: r.name,
              permissions: r.permissions.map((p) => p.permission.key),
            }))}
            allPermissions={permissions.map((p) => ({ key: p.key, description: p.description }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
