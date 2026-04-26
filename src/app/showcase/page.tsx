import Link from "next/link";
import { PageLayout } from "@/components/page-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { showcaseNavLinks } from "@/components/showcase-nav";

export default function ShowcaseHome() {
  return (
    <PageLayout>
      <div className="mx-auto max-w-5xl">
        <h1 className="text-4xl font-bold tracking-tight">Showcase</h1>
        <p className="mt-3 text-muted-foreground">
          Reference design system, component gallery, and template previews.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {showcaseNavLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              <Card className="h-full transition-colors hover:border-foreground/20">
                <CardHeader>
                  <CardTitle>{link.label}</CardTitle>
                  <CardDescription>{link.href}</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
