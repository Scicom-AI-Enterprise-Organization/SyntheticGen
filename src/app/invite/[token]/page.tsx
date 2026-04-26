import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { RegisterForm } from "./register-form";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await auth();

  const invite = await prisma.invitation.findUnique({
    where: { token },
    include: { role: true, invitedBy: { select: { email: true, name: true } } },
  });

  if (!invite) return <InviteState title="Invalid invitation" body="This link is not recognized." />;
  if (invite.revokedAt) return <InviteState title="Invitation revoked" body="The owner revoked this invite." />;
  if (invite.acceptedAt) return <InviteState title="Already accepted" body="This invitation has already been used." />;
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return <InviteState title="Invitation expired" body="Ask the sender to issue a new link." />;
  }

  // Unauth: render the register form so the user can create an account in one shot.
  // The footer of the form links to /login for users who already have an account.
  if (!session?.user?.id) {
    const inviterLabel =
      invite.invitedBy?.name ?? invite.invitedBy?.email ?? "Someone on the team";
    return (
      <RegisterForm
        token={token}
        inviteEmail={invite.email ?? null}
        inviterLabel={inviterLabel}
        roleName={invite.role?.name ?? null}
      />
    );
  }

  if (invite.email && invite.email.toLowerCase() !== session.user.email?.toLowerCase()) {
    return (
      <InviteState
        title="This invite is for a different email"
        body={`Sign in as ${invite.email} to accept it.`}
      />
    );
  }

  await prisma.$transaction(async (tx) => {
    if (invite.roleId) {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: session.user.id, roleId: invite.roleId } },
        update: {},
        create: { userId: session.user.id, roleId: invite.roleId },
      });
    }
    await tx.invitation.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date(), acceptedById: session.user.id },
    });
  });

  return (
    <InviteState
      title="Welcome aboard"
      body={
        invite.role
          ? `You've been added with the "${invite.role.name}" role.`
          : "Your invitation has been accepted."
      }
      cta={
        <Button asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      }
    />
  );
}

function InviteState({
  title,
  body,
  cta,
}: {
  title: string;
  body: React.ReactNode;
  cta?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 max-w-md text-muted-foreground">{body}</p>
      <div className="mt-6">
        {cta ?? (
          <Button asChild variant="outline">
            <Link href="/">Back home</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
