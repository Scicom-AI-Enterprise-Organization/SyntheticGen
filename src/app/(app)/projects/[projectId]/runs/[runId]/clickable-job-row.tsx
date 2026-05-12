"use client";

import { useRouter } from "next/navigation";
import { type ReactNode } from "react";

// Lightweight client wrapper that makes a <tr> behave as a Link without
// putting an anchor element inside the table (which would be invalid HTML).
// Clicking anywhere in the row navigates to `href`; clicks on nested
// buttons / links (action column) are ignored so they keep their own
// behavior. Keyboard: Enter / Space activates the navigation, role="button"
// + tabIndex=0 makes it focusable.
export function ClickableJobRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  function navigate() {
    router.push(href, { scroll: false });
  }
  return (
    <tr
      className={className}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        // Ignore clicks that originate from any interactive element so the
        // existing "View conversation" / "Jumpstart" buttons keep working.
        if (target.closest("a, button, [role='button'], input, label, summary")) {
          // The row itself has role="button" — only swallow clicks that
          // hit a *child* interactive element, not the row chrome itself.
          if (target.closest("a, button, input, label, summary")) return;
        }
        navigate();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {children}
    </tr>
  );
}
