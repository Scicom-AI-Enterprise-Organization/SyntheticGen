"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Building2,
  FileCode,
  FlaskConical,
  FolderKanban,
  Gauge,
  GitBranch,
  Home,
  KeySquare,
  Languages,
  LayoutDashboard,
  MessagesSquare,
  Network,
  Play,
  Settings,
  ShieldCheck,
  User,
  Users,
  Users2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebarState } from "./sidebar-state";

type Item = {
  label: string;
  href: string;
  icon: LucideIcon;
};

interface ProjectSummary {
  id: string;
  name: string;
}

const WORKSPACE: Item[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", href: "/projects", icon: FolderKanban },
];

const ACCOUNT: Item[] = [{ label: "Profile", href: "/profile", icon: User }];

const ADMIN: Item[] = [
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Roles", href: "/admin/roles", icon: ShieldCheck },
  { label: "Organization", href: "/admin/organization", icon: Building2 },
];

const PROJECT_NAV: { label: string; segment: string; icon: LucideIcon }[] = [
  { label: "Overview", segment: "", icon: Home },
  { label: "Taxonomy", segment: "taxonomy", icon: Network },
  { label: "Personas", segment: "personas", icon: Users2 },
  { label: "Languages", segment: "languages", icon: Languages },
  { label: "Templates", segment: "templates", icon: FileCode },
  { label: "Knowledge", segment: "knowledge", icon: BookOpen },
  { label: "Flows", segment: "flows", icon: GitBranch },
  { label: "Tools", segment: "tools", icon: Wrench },
  { label: "Runs", segment: "runs", icon: Play },
  { label: "Conversations", segment: "conversations", icon: MessagesSquare },
  { label: "Benchmarks", segment: "benchmarks", icon: FlaskConical },
  { label: "Rubrics", segment: "rubrics", icon: Gauge },
  { label: "Providers", segment: "providers", icon: KeySquare },
  { label: "Settings", segment: "settings", icon: Settings },
];

function activeProjectIdFrom(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  if (!m) return null;
  const id = m[1];
  if (id === "new") return null;
  return id;
}

export function AppSidebar({
  isAdmin,
  projects,
}: {
  isAdmin: boolean;
  projects: ProjectSummary[];
}) {
  const pathname = usePathname();
  const { mobileOpen, closeMobile } = useSidebarState();

  const activeProjectId = activeProjectIdFrom(pathname);
  const activeProject = activeProjectId
    ? (projects.find((p) => p.id === activeProjectId) ?? {
        id: activeProjectId,
        name: "Project",
      })
    : null;

  const isActive = (href: string) => {
    if (href === "/projects") {
      return pathname === "/projects";
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <>
      {mobileOpen && (
        <button
          aria-label="Close sidebar"
          onClick={closeMobile}
          className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm md:hidden"
        />
      )}

      <aside
        className={cn(
          "h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 ease-out",
          "hidden md:flex md:w-60",
          mobileOpen
            ? "fixed inset-y-0 left-0 z-40 flex w-64 translate-x-0"
            : "max-md:-translate-x-full max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-64",
        )}
      >
        <Link
          href="/dashboard"
          onClick={closeMobile}
          className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4 hover:bg-sidebar-accent/40"
        >
          <Image
            src="/images/scicom-logo.png"
            alt="Scicom"
            width={96}
            height={24}
            priority
            className="h-6 w-auto select-none"
          />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            SyntheticGen
          </span>
        </Link>

        <nav className="flex-1 overflow-y-auto py-3">
          <SidebarGroup label="Workspace">
            {WORKSPACE.map((item) => (
              <SidebarItem
                key={item.label}
                item={item}
                active={isActive(item.href)}
                onNavigate={closeMobile}
              />
            ))}
          </SidebarGroup>

          {activeProject && (
            <SidebarGroup label={activeProject.name}>
              {PROJECT_NAV.map((nav) => {
                const href = nav.segment
                  ? `/projects/${activeProject.id}/${nav.segment}`
                  : `/projects/${activeProject.id}`;
                const active =
                  pathname === href ||
                  (!!nav.segment && pathname.startsWith(href + "/"));
                return (
                  <SidebarItem
                    key={href}
                    item={{ label: nav.label, href, icon: nav.icon }}
                    active={active}
                    onNavigate={closeMobile}
                  />
                );
              })}
            </SidebarGroup>
          )}

          <SidebarGroup label="Account">
            {ACCOUNT.map((item) => (
              <SidebarItem
                key={item.label}
                item={item}
                active={isActive(item.href)}
                onNavigate={closeMobile}
              />
            ))}
          </SidebarGroup>

          {isAdmin && (
            <SidebarGroup label="Admin">
              {ADMIN.map((item) => (
                <SidebarItem
                  key={item.label}
                  item={item}
                  active={isActive(item.href)}
                  onNavigate={closeMobile}
                />
              ))}
            </SidebarGroup>
          )}
        </nav>
      </aside>
    </>
  );
}

function SidebarGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="mt-3 flex w-full items-center px-4 py-1.5 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <ul className="space-y-px px-2">{children}</ul>
    </>
  );
}

function SidebarItem({
  item,
  active,
  onNavigate,
}: {
  item: Item;
  active?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
      </Link>
    </li>
  );
}
