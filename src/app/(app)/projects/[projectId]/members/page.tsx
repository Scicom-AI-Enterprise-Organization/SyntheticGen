import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AddMemberForm } from "./add-member-form";
import { MembersTable } from "./members-table";

export default async function ProjectMembersPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { role } = await requireProjectPermission(projectId, "project.read");
  const canManage = role === "OWNER";

  const members = await prisma.projectMember.findMany({
    where: { projectId },
    orderBy: [{ role: "asc" }, { addedAt: "asc" }],
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Project-scoped roles. Existing users only — invite via /admin/organization first.
        </p>
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Add member</CardTitle>
            <CardDescription>Use the user&apos;s account email.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddMemberForm projectId={projectId} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Current members ({members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <MembersTable
            projectId={projectId}
            canManage={canManage}
            members={members.map((m) => ({
              userId: m.userId,
              email: m.user.email,
              name: m.user.name,
              role: m.role,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
