import { headers } from "next/headers";
import { requirePermission } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteForm } from "./invite-form";
import { InvitationsTable } from "./invitations-table";

export default async function OrganizationPage() {
  await requirePermission("invites:read");

  const [invitations, roles, h] = await Promise.all([
    prisma.invitation.findMany({
      orderBy: { createdAt: "desc" },
      include: { role: true, invitedBy: true, acceptedBy: true },
    }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
    headers(),
  ]);

  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const baseUrl = process.env.AUTH_URL ?? `${proto}://${host}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Organization</h1>
        <p className="mt-2 text-muted-foreground">
          Invite people to your workspace by sharing a sign-up link.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create invite</CardTitle>
          <CardDescription>
            Optionally bind to an email and pre-assign a role. The link is shareable until it expires or is revoked.
          </CardDescription>
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
    </div>
  );
}
