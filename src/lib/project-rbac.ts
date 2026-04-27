import { redirect } from "next/navigation";
import { ProjectRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, type SessionUser, hasPermission } from "@/lib/rbac";

export type ProjectAction =
  | "project.read"
  | "project.update"
  | "project.delete"
  | "members.manage"
  | "providers.manage"
  | "taxonomy.read"
  | "taxonomy.write"
  | "personas.read"
  | "personas.write"
  | "languages.read"
  | "languages.write"
  | "tools.read"
  | "tools.write"
  | "templates.read"
  | "templates.write"
  | "flows.read"
  | "flows.write"
  | "runs.read"
  | "runs.execute"
  | "runs.cancel"
  | "conversations.read"
  | "conversations.annotate"
  | "datasets.read"
  | "datasets.freeze"
  | "datasets.export";

const ROLE_ACTIONS: Record<ProjectRole, ProjectAction[]> = {
  OWNER: [
    "project.read", "project.update", "project.delete", "members.manage",
    "providers.manage",
    "taxonomy.read", "taxonomy.write",
    "personas.read", "personas.write",
    "languages.read", "languages.write",
    "tools.read", "tools.write",
    "templates.read", "templates.write",
    "flows.read", "flows.write",
    "runs.read", "runs.execute", "runs.cancel",
    "conversations.read", "conversations.annotate",
    "datasets.read", "datasets.freeze", "datasets.export",
  ],
  EDITOR: [
    "project.read",
    "providers.manage",
    "taxonomy.read", "taxonomy.write",
    "personas.read", "personas.write",
    "languages.read", "languages.write",
    "tools.read", "tools.write",
    "templates.read", "templates.write",
    "flows.read", "flows.write",
    "runs.read", "runs.execute", "runs.cancel",
    "conversations.read", "conversations.annotate",
    "datasets.read", "datasets.freeze", "datasets.export",
  ],
  ANNOTATOR: [
    "project.read",
    "taxonomy.read", "personas.read", "languages.read", "tools.read",
    "templates.read", "flows.read", "runs.read",
    "conversations.read", "conversations.annotate",
    "datasets.read",
  ],
  VIEWER: [
    "project.read",
    "taxonomy.read", "personas.read", "languages.read", "tools.read",
    "templates.read", "flows.read", "runs.read",
    "conversations.read", "datasets.read",
  ],
};

export function projectRoleAllows(role: ProjectRole, action: ProjectAction): boolean {
  return ROLE_ACTIONS[role].includes(action);
}

export type ProjectMembership = {
  user: SessionUser;
  projectId: string;
  role: ProjectRole | null;
};

async function loadMembership(projectId: string, userId: string): Promise<ProjectRole | null> {
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  return member?.role ?? null;
}

export async function getProjectMembership(
  user: SessionUser,
  projectId: string,
): Promise<ProjectRole | null> {
  // Global admin sees all projects with effective OWNER rights.
  if (hasPermission(user, "users:write") && hasPermission(user, "roles:write")) {
    return "OWNER";
  }
  return loadMembership(projectId, user.id);
}

/**
 * Page/Server-Action gate. Redirects to /login if not authed, /forbidden if not permitted.
 * Returns the resolved membership for further use.
 */
export async function requireProjectPermission(
  projectId: string,
  action: ProjectAction,
): Promise<ProjectMembership> {
  const user = await requireUser();
  const role = await getProjectMembership(user, projectId);
  if (!role || !projectRoleAllows(role, action)) {
    redirect("/forbidden");
  }
  return { user, projectId, role };
}

/**
 * API-route gate. Throws instead of redirecting; caller decides response shape.
 */
export async function checkProjectPermission(
  user: SessionUser,
  projectId: string,
  action: ProjectAction,
): Promise<{ ok: true; role: ProjectRole } | { ok: false; reason: "no-membership" | "no-permission" }> {
  const role = await getProjectMembership(user, projectId);
  if (!role) return { ok: false, reason: "no-membership" };
  if (!projectRoleAllows(role, action)) return { ok: false, reason: "no-permission" };
  return { ok: true, role };
}
