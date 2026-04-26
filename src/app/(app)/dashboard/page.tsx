import { requireUser } from "@/lib/rbac";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-3xl font-bold tracking-tight">
        Welcome{user.name ? `, ${user.name}` : ""}
      </h1>
      <p className="mt-2 text-muted-foreground">{user.email}</p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
            <CardDescription>Roles assigned to your account.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {user.roles.length === 0 && (
              <span className="text-sm text-muted-foreground">No roles assigned.</span>
            )}
            {user.roles.map((r) => (
              <Badge key={r} variant="secondary">
                {r}
              </Badge>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Permissions</CardTitle>
            <CardDescription>Effective permissions from your roles.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {user.permissions.length === 0 && (
              <span className="text-sm text-muted-foreground">No permissions.</span>
            )}
            {user.permissions.map((p) => (
              <Badge key={p} variant="outline">
                {p}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
