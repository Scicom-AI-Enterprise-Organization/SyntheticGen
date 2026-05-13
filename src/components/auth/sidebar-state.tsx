"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

type Ctx = {
  mobileOpen: boolean;
  togglePanel: () => void;
  closeMobile: () => void;
};

const SidebarStateContext = createContext<Ctx | null>(null);

export function SidebarStateProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const togglePanel = useCallback(() => {
    setMobileOpen((prev) => !prev);
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const value = useMemo(
    () => ({ mobileOpen, togglePanel, closeMobile }),
    [mobileOpen, togglePanel, closeMobile],
  );
  return <SidebarStateContext.Provider value={value}>{children}</SidebarStateContext.Provider>;
}

export function useSidebarState() {
  return (
    useContext(SidebarStateContext) ?? {
      mobileOpen: false,
      togglePanel: () => {},
      closeMobile: () => {},
    }
  );
}
