"use client";

import { useEffect, useRef } from "react";

// Hook: keeps a scrollable element pinned to its bottom edge *only* if the
// user is already near the bottom when new content arrives. If they've
// scrolled up to read something, the hook does NOTHING — no fighting the
// user mid-scroll.
//
// Implementation:
//   - Returns a ref you attach to the scrollable element.
//   - Reads the live scroll position at the moment content changes (no
//     debounced flag, no race with passive scroll listeners).
//   - Within `threshold` px of the bottom is considered "following" and gets
//     snapped down on the next paint.
//   - Outside that window means the user has intentionally scrolled away;
//     leave them alone.
//
// Call by passing any dependency (text length, message array length, etc.)
// that signals new content has arrived:
//
//     const ref = useStickyBottom([text]);
//     <pre ref={ref}>{text}</pre>
//
// `threshold` defaults to 64 px so a tiny gap from anti-aliasing or
// late-paint doesn't accidentally count as "scrolled up". Override per
// container if its line-height makes 64 too tight or too loose.
export function useStickyBottom<T extends HTMLElement>(
  deps: React.DependencyList,
  threshold = 64,
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure BEFORE the new content shifts scrollHeight. (We're called in
    // a useEffect, after React commits, so scrollHeight already reflects
    // the new content — but the user's scrollTop is still where they left
    // it. distance-from-bottom captures their current viewpoint.)
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance <= threshold) {
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
