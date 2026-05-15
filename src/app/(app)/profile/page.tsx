import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProfileForm } from "./profile-form";
import { PasswordForm } from "./password-form";

export default async function ProfilePage() {
  const sessionUser = await requireUser();

  const dbUser = await prisma.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      passwordHash: true,
      createdAt: true,
      accounts: { select: { provider: true } },
    },
  });

  const linkedProviders = Array.from(
    new Set([
      ...(dbUser.passwordHash ? ["credentials"] : []),
      ...dbUser.accounts.map((a) => a.provider),
    ]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account details and password.
        </p>
      </div>

      <ProfileForm initialName={dbUser.name ?? ""} email={dbUser.email} />

      <PasswordForm hasPassword={!!dbUser.passwordHash} />

      <Card>
        <CardHeader>
          <CardTitle>Access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sign-in methods
            </div>
            <div className="flex flex-wrap gap-2">
              {linkedProviders.length === 0 && (
                <span className="text-muted-foreground">None</span>
              )}
              {linkedProviders.map((p) => (
                <Badge key={p} variant="secondary">
                  {p}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Roles
            </div>
            <div className="flex flex-wrap gap-2">
              {sessionUser.roles.length === 0 && (
                <span className="text-muted-foreground">None</span>
              )}
              {sessionUser.roles.map((r) => (
                <Badge key={r} variant="secondary">
                  {r}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Permissions
            </div>
            <div className="flex flex-wrap gap-2">
              {sessionUser.permissions.length === 0 && (
                <span className="text-muted-foreground">None</span>
              )}
              {sessionUser.permissions.map((p) => (
                <Badge key={p} variant="outline">
                  {p}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
