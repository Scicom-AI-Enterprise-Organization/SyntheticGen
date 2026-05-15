import { headers } from "next/headers";
import { UserPlus } from "lucide-react";
import { requirePermission, hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InviteForm } from "./invite-form";
import { InvitationsTable } from "./invitations-table";
import { UsersTable } from "./users-table";

export default async function OrganizationPage() {
  const user = await requirePermission("invites:read");
  const canManageUsers = hasPermission(user, "users:read");

  const [invitations, roles, users, h] = await Promise.all([
    prisma.invitation.findMany({
      orderBy: { createdAt: "desc" },
      include: { role: true, invitedBy: true, acceptedBy: true },
    }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
    canManageUsers
      ? prisma.user.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            roles: { include: { role: true } },
            accounts: { select: { provider: true } },
          },
        })
      : Promise.resolve([]),
    headers(),
  ]);

  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const baseUrl = process.env.AUTH_URL ?? `${proto}://${host}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organization</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage users and invitations
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Invite by link
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InviteForm roles={roles.map((r) => r.name)} baseUrl={baseUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>
            {invitations.length} total · click an active invite to copy the link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InvitationsTable
            baseUrl={baseUrl}
            invitations={invitations.map((i) => ({
              id: i.id,
              token: i.token,
              email: i.email,
              roleName: i.role?.name ?? null,
              invitedBy: i.invitedBy?.email ?? null,
              acceptedBy: i.acceptedBy?.email ?? null,
              acceptedAt: i.acceptedAt?.toISOString() ?? null,
              expiresAt: i.expiresAt?.toISOString() ?? null,
              revokedAt: i.revokedAt?.toISOString() ?? null,
              createdAt: i.createdAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>

      {canManageUsers && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Members
              <Badge variant="secondary">{users.length}</Badge>
            </CardTitle>
            <CardDescription>Manage users and role assignments.</CardDescription>
          </CardHeader>
          <CardContent>
            <UsersTable
              users={users.map((u) => ({
                id: u.id,
                email: u.email,
                name: u.name,
                roles: u.roles.map((ur) => ur.role.name),
                hasLocalPassword: Boolean(u.passwordHash),
                providers: u.accounts.map((a) => a.provider),
                createdAt: u.createdAt.toISOString(),
              }))}
              allRoles={roles.map((r) => r.name)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
