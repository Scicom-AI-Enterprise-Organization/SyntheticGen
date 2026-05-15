import Link from "next/link";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { ResetPasswordForm } from "./reset-form";

const RESET_TOKEN_PREFIX = "pwd-reset:";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const record = await prisma.verificationToken.findUnique({ where: { token } });

  if (!record || !record.identifier.startsWith(RESET_TOKEN_PREFIX)) {
    return <ResetState title="Invalid reset link" body="This link is not recognized." />;
  }
  if (record.expires < new Date()) {
    return (
      <ResetState
        title="Reset link expired"
        body="Ask an admin to issue a new password-reset link."
      />
    );
  }

  const userId = record.identifier.slice(RESET_TOKEN_PREFIX.length);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) {
    return <ResetState title="Account missing" body="The account this link refers to no longer exists." />;
  }

  return <ResetPasswordForm token={token} email={user.email} />;
}

function ResetState({
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
            <Link href="/login">Back to sign in</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
