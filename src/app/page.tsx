import Link from "next/link";
import { ArrowRight, Shield, Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { PageFooter } from "@/components/page-footer";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <PageHeader
        links={[
          { href: "/dashboard", label: "Dashboard" },
          { href: "/showcase", label: "Showcase" },
        ]}
        actions={
          <Button asChild size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        }
      />

      <main className="flex flex-1 items-center justify-center px-4">
        <div className="mx-auto max-w-3xl py-16 text-center">
          <h1 className="text-balance text-5xl font-bold tracking-tight">
            Enterprise Template
          </h1>
          <p className="mt-6 text-balance text-lg text-muted-foreground">
            A Next.js 16 starter with RBAC, SSO (Azure AD, Google, Keycloak,
            SAML), credentials auth, Prisma, and a Radix UI design system.
          </p>

          <div className="mt-10 flex justify-center gap-4">
            <Button asChild size="lg">
              <Link href="/login">
                Get started <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/showcase">View showcase</Link>
            </Button>
          </div>

          <div className="mt-16 grid gap-6 text-left sm:grid-cols-3">
            <Feature
              icon={<Lock className="h-5 w-5" />}
              title="SSO + Credentials"
              body="Auth.js v5 with Azure AD, Google, Keycloak, SAML and email/password."
            />
            <Feature
              icon={<Shield className="h-5 w-5" />}
              title="RBAC"
              body="Roles + permissions enforced via middleware and server helpers."
            />
            <Feature
              icon={<Users className="h-5 w-5" />}
              title="User admin"
              body="Built-in admin to manage users, roles, and permissions."
            />
          </div>
        </div>
      </main>

      <PageFooter />
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-border p-5">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md bg-muted">
        {icon}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
