import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="mt-2 text-muted-foreground">
          Manage your account details and password.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Your email is set by your sign-in method and can&apos;t be changed here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            initialName={dbUser.name ?? ""}
            email={dbUser.email}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            {dbUser.passwordHash
              ? "Change your password. You'll stay signed in on this device."
              : "Set a password to enable email + password sign-in alongside SSO."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm hasPassword={!!dbUser.passwordHash} />
        </CardContent>
      </Card>

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
