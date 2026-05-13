"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "./user-menu";
import { useSidebarState } from "./sidebar-state";

interface ProjectSummary {
  id: string;
  name: string;
}

const STATIC_TITLES: Array<{ match: RegExp; label: string }> = [
  { match: /^\/dashboard/, label: "Dashboard" },
  { match: /^\/projects\/new/, label: "New project" },
  { match: /^\/projects$/, label: "Projects" },
  { match: /^\/profile/, label: "Profile" },
  { match: /^\/admin\/users/, label: "Users" },
  { match: /^\/admin\/roles/, label: "Roles" },
  { match: /^\/admin\/organization/, label: "Organization" },
];

const PROJECT_SUBPAGE_TITLES: Record<string, string> = {
  taxonomy: "Taxonomy",
  personas: "Personas",
  languages: "Languages",
  templates: "Templates",
  knowledge: "Knowledge",
  flows: "Flows",
  tools: "Tools",
  runs: "Runs",
  conversations: "Conversations",
  datasets: "Datasets",
  benchmarks: "Benchmarks",
  rubrics: "Rubrics",
  providers: "Providers",
  settings: "Settings",
};

function deriveTitle(pathname: string, projects: ProjectSummary[]): string {
  const projectMatch = pathname.match(/^\/projects\/([^/]+)(?:\/([^/]+))?/);
  if (projectMatch && projectMatch[1] !== "new") {
    const project = projects.find((p) => p.id === projectMatch[1]);
    const name = project?.name ?? "Project";
    const segment = projectMatch[2];
    if (segment && PROJECT_SUBPAGE_TITLES[segment]) {
      return `${name} · ${PROJECT_SUBPAGE_TITLES[segment]}`;
    }
    return name;
  }
  const hit = STATIC_TITLES.find((t) => t.match.test(pathname));
  return hit?.label ?? "";
}

export function AppTopbar({ projects }: { projects: ProjectSummary[] }) {
  const pathname = usePathname();
  const { togglePanel } = useSidebarState();
  const title = deriveTitle(pathname, projects);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-sidebar px-3 lg:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={togglePanel}
          className="inline-flex shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-4 w-4" />
        </button>
        {title && (
          <span className="ml-1 truncate text-sm font-medium text-foreground md:ml-2">
            {title}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
