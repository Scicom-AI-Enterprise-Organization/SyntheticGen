import Link from "next/link";
import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>
      {/* Left — Brand hero. Hidden on mobile to free up space for the form. */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-primary/15 via-background to-primary/5 lg:block">
        {/* Faint dot grid for visual texture */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.4] [background-image:radial-gradient(circle,_var(--muted-foreground)_1px,_transparent_1px)] [background-size:18px_18px]"
        />
        <div className="relative z-10 flex h-full flex-col justify-between p-10">
          <Link href="/" className="inline-flex items-center gap-3 self-start">
            <Image
              src="/images/scicom-logo.png"
              alt="Scicom"
              width={140}
              height={36}
              priority
              className="h-9 w-auto select-none"
            />
            <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              SyntheticGen
            </span>
          </Link>
          <div className="max-w-md space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              Generate localized synthetic datasets at scale.
            </h2>
            <p className="text-sm text-muted-foreground">
              Persona-aware, formality-locked, multilingual conversations with
              per-locale register enforcement and code-switching support.
            </p>
          </div>
        </div>
      </div>

      {/* Right — Form. Carries its own logo on small screens since the hero is hidden. */}
      <div className="flex flex-col items-center justify-center bg-slate-50 px-6 py-10 dark:bg-slate-950 sm:px-10">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-2 lg:hidden"
          >
            <Image
              src="/images/scicom-logo.png"
              alt="Scicom"
              width={120}
              height={32}
              priority
              className="h-8 w-auto select-none"
            />
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              SyntheticGen
            </span>
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}
