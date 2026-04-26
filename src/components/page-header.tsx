"use client";

import Link from "next/link";
import { Sun, Moon } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useThemeMode } from "@/hooks/use-theme-mode";

interface NavLink {
  href: string;
  label: string;
}

interface PageHeaderProps {
  /** Brand label shown in the top-left. */
  brand?: string;
  /** Navigation links. Defaults to none. */
  links?: NavLink[];
  /** Right-side slot (e.g. user menu). */
  actions?: React.ReactNode;
}

export function PageHeader({
  brand = "Enterprise Template",
  links = [],
  actions,
}: PageHeaderProps) {
  const { isDark, toggleTheme } = useThemeMode();

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="z-50 w-full shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <nav className="flex h-16 items-center justify-between px-4 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            {brand}
          </Link>
        </div>

        {links.length > 0 && (
          <div className="hidden items-center gap-8 md:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          {actions}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="rounded-full"
            aria-label="Toggle theme"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </nav>
    </motion.header>
  );
}
