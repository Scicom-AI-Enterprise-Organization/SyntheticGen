import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "project.read");

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, archivedAt: true },
  });
  if (!project) notFound();

  return (
    <>
      {project.archivedAt && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          This project is archived. New runs and edits are disabled.
        </div>
      )}
      {children}
    </>
  );
}
