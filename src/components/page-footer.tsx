"use client";

interface PageFooterProps {
  /** Optional: Custom description text */
  description?: string;
  /** Optional: brand label */
  brand?: string;
}

export function PageFooter({
  brand = "Enterprise Template",
  description = "Built with Next.js, Tailwind CSS, and Radix UI.",
}: PageFooterProps) {
  return (
    <footer className="border-t border-border py-8">
      <div className="container mx-auto px-4 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <span className="text-sm font-medium text-muted-foreground">
            {brand}
          </span>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </footer>
  );
}
