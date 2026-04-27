"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  FileCode,
  FolderKanban,
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
  UserCog,
  Users,
  Users2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

interface SidebarSection {
  title?: string;
  items: NavItem[];
}

interface ProjectSummary {
  id: string;
  name: string;
}

const PROJECT_NAV: { label: string; segment: string; icon: LucideIcon }[] = [
  { label: "Overview", segment: "", icon: Home },
  { label: "Taxonomy", segment: "taxonomy", icon: Network },
  { label: "Personas", segment: "personas", icon: Users2 },
  { label: "Languages", segment: "languages", icon: Languages },
  { label: "Templates", segment: "templates", icon: FileCode },
  { label: "Flows", segment: "flows", icon: GitBranch },
  { label: "Tools", segment: "tools", icon: Wrench },
  { label: "Providers", segment: "providers", icon: KeySquare },
  { label: "Runs", segment: "runs", icon: Play },
  { label: "Conversations", segment: "conversations", icon: MessagesSquare },
  { label: "Datasets", segment: "datasets", icon: Database },
  { label: "Settings", segment: "settings", icon: Settings },
];

function activeProjectIdFrom(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  return m ? m[1] : null;
}

export function AppSidebar({
  isAdmin,
  projects,
}: {
  isAdmin: boolean;
  projects: ProjectSummary[];
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(true);

  const activeProjectId = activeProjectIdFrom(pathname);
  const activeProject = activeProjectId
    ? (projects.find((p) => p.id === activeProjectId) ?? {
        id: activeProjectId,
        // The path is on a project page but the project isn't in the user's pre-fetched
        // list (e.g. global admin viewing someone else's project) — show a generic label.
        name: "Project",
      })
    : null;

  return (
    <div className="relative flex shrink-0">
      <aside
        className={cn(
          "overflow-y-auto border-r border-border transition-[width] duration-300 ease-in-out",
          isOpen ? "w-64" : "w-14",
        )}
      >
        <nav className="space-y-2 px-2 pt-8 pb-8">
          <SidebarSectionView
            section={{
              items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
            }}
            isOpen={isOpen}
            pathname={pathname}
          />

          <div className="space-y-0.5">
            {isOpen ? (
              <button
                type="button"
                onClick={() => setProjectsOpen((v) => !v)}
                className={cn(
                  "flex w-full items-center rounded-md py-1.5 text-sm transition-colors",
                  pathname === "/projects" || pathname.startsWith("/projects/")
                    ? "bg-primary/10 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="flex h-9 w-10 shrink-0 items-center justify-center">
                  <FolderKanban className="h-4 w-4" />
                </span>
                <span className="flex-1 text-left">Projects</span>
                <span className="pr-2">
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 transition-transform",
                      projectsOpen ? "rotate-0" : "-rotate-90",
                    )}
                  />
                </span>
              </button>
            ) : (
              <Link
                href="/projects"
                title="Projects"
                className={cn(
                  "flex h-12 w-10 items-center justify-center rounded-md transition-colors",
                  pathname.startsWith("/projects")
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <FolderKanban className="h-4 w-4" />
              </Link>
            )}

            {isOpen && projectsOpen && (
              <div className="ml-4 space-y-0.5 border-l border-border/60 pl-2">
                <Link
                  href="/projects"
                  className={cn(
                    "block rounded-md py-1 pl-2 text-xs transition-colors",
                    pathname === "/projects"
                      ? "bg-primary/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  All projects
                </Link>

                {activeProject && (
                  <div className="mt-2 rounded-md bg-muted/30 p-2">
                    <div className="mb-1 truncate px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {activeProject.name}
                    </div>
                    {PROJECT_NAV.map((item) => {
                      const href = item.segment
                        ? `/projects/${activeProject.id}/${item.segment}`
                        : `/projects/${activeProject.id}`;
                      const isActive =
                        pathname === href ||
                        (!!item.segment && pathname.startsWith(href + "/"));
                      const Icon = item.icon;
                      return (
                        <Link
                          key={href}
                          href={href}
                          className={cn(
                            "flex items-center rounded-md py-1 text-xs transition-colors",
                            isActive
                              ? "bg-primary/10 font-medium text-foreground"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <span className="flex h-7 w-8 shrink-0 items-center justify-center">
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="truncate">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <SidebarSectionView
            section={{
              items: [{ label: "Profile", href: "/profile", icon: UserCog }],
            }}
            isOpen={isOpen}
            pathname={pathname}
          />

          {isAdmin && (
            <SidebarSectionView
              section={{
                title: "Admin",
                items: [
                  { label: "Users", href: "/admin/users", icon: Users },
                  { label: "Roles", href: "/admin/roles", icon: ShieldCheck },
                  { label: "Organization", href: "/admin/organization", icon: Building2 },
                ],
              }}
              isOpen={isOpen}
              pathname={pathname}
            />
          )}
        </nav>
      </aside>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="absolute -right-3 top-10 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
        aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {isOpen ? (
          <ChevronLeft className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

function SidebarSectionView({
  section,
  isOpen,
  pathname,
}: {
  section: SidebarSection;
  isOpen: boolean;
  pathname: string;
}) {
  return (
    <div className="space-y-0.5">
      {section.title && (
        <div
          className="flex h-8 items-center justify-between overflow-hidden rounded-md px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          aria-hidden={!isOpen}
        >
          {isOpen ? (
            <span className="truncate">{section.title}</span>
          ) : (
            <span className="mx-auto h-px w-6 bg-border" />
          )}
        </div>
      )}
      {section.items.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;

        if (!isOpen) {
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={cn(
                "flex h-12 w-10 items-center justify-center rounded-md transition-colors",
                isActive
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
            </Link>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center rounded-md py-1.5 text-sm transition-colors",
              isActive
                ? "bg-primary/10 font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className="flex h-9 w-10 shrink-0 items-center justify-center">
              <Icon className="h-4 w-4" />
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
