"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProjectPermission } from "@/lib/project-rbac";
import { logAudit } from "@/lib/audit";

const upsertToolSchema = z.object({
  projectId: z.string(),
  catalogId: z.string(),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Use snake_case identifier (a-z, 0-9, _)"),
  description: z.string().min(1).max(2000),
  parametersJson: z.string().min(2),
  localePresets: z.array(z.string()).default([]),
  // Optional synthetic argument examples produced by AI-assist self-verify.
  examples: z.array(z.record(z.string(), z.unknown())).optional().nullable(),
});

export async function createToolDef(input: z.infer<typeof upsertToolSchema>) {
  const parsed = upsertToolSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "tools.write");

  let parameters: Prisma.InputJsonValue;
  try {
    parameters = JSON.parse(parsed.data.parametersJson);
  } catch (e) {
    return { error: `parameters: invalid JSON — ${(e as Error).message}` };
  }
  if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
    return { error: "parameters: must be a JSON object (JSON Schema)" };
  }

  const created = await prisma.toolDef.create({
    data: {
      catalogId: parsed.data.catalogId,
      name: parsed.data.name,
      description: parsed.data.description,
      parameters,
      localePresets: parsed.data.localePresets,
      examples:
        parsed.data.examples && parsed.data.examples.length > 0
          ? (parsed.data.examples as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "tool.create",
    targetKind: "ToolDef",
    targetId: created.id,
    metadata: { name: created.name },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/tools`);
  return { ok: true, id: created.id };
}

export async function deleteToolDef(projectId: string, id: string) {
  const { user } = await requireProjectPermission(projectId, "tools.write");
  await prisma.toolDef.delete({ where: { id } });
  await logAudit({
    projectId,
    actorUserId: user.id,
    action: "tool.delete",
    targetKind: "ToolDef",
    targetId: id,
  });
  revalidatePath(`/projects/${projectId}/tools`);
  return { ok: true };
}
