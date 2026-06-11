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

const updateToolSchema = upsertToolSchema.extend({
  id: z.string(),
});

export async function updateToolDef(input: z.infer<typeof updateToolSchema>) {
  const parsed = updateToolSchema.safeParse(input);
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

  const existing = await prisma.toolDef.findUnique({
    where: { id: parsed.data.id },
    select: { catalog: { select: { projectId: true } } },
  });
  if (!existing || existing.catalog.projectId !== parsed.data.projectId) {
    return { error: "Tool not found in this project" };
  }

  const updated = await prisma.toolDef.update({
    where: { id: parsed.data.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      parameters,
      localePresets: parsed.data.localePresets,
      examples:
        parsed.data.examples && parsed.data.examples.length > 0
          ? (parsed.data.examples as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      version: { increment: 1 },
    },
  });

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "tool.update",
    targetKind: "ToolDef",
    targetId: updated.id,
    metadata: { name: updated.name, version: updated.version },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/tools`);
  return { ok: true, id: updated.id, version: updated.version };
}

// Bulk-import a JSON array of tool definitions. Accepts the OpenAI
// function-calling shape (each item has `name`, `description`,
// `parameters` object, plus optional extras like `stage`/`returns` that
// we record as locale presets / appended description). Idempotent via
// `mode: "skip" | "overwrite"`:
//   - skip: existing tools with the same name in this catalog are left alone
//   - overwrite: same-name tools are replaced (Prisma upsert by composite key)
// Returns per-item outcomes so the UI can show which succeeded vs failed
// without the whole batch aborting on one bad row.
const bulkImportSchema = z.object({
  projectId: z.string(),
  catalogId: z.string(),
  // Raw JSON string the user pasted. Parsed inside the action.
  json: z.string().min(2),
  mode: z.enum(["skip", "overwrite"]).default("skip"),
});

export type BulkImportItemResult =
  | { ok: true; name: string; id: string; action: "created" | "updated" }
  | { ok: false; index: number; name: string | null; error: string };

export async function bulkImportToolDefs(input: z.infer<typeof bulkImportSchema>) {
  const parsed = bulkImportSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const { user } = await requireProjectPermission(parsed.data.projectId, "tools.write");

  let raw: unknown;
  try {
    raw = JSON.parse(parsed.data.json);
  } catch (e) {
    return { error: `JSON parse failed: ${(e as Error).message}` };
  }
  if (!Array.isArray(raw)) {
    return { error: "Expected a JSON array of tool definitions." };
  }

  // Pull existing names in this catalog once so we can detect duplicates
  // without N round-trips. Existing tools are keyed by name (the unique
  // constraint is (catalogId, name, version)).
  const existing = await prisma.toolDef.findMany({
    where: { catalogId: parsed.data.catalogId },
    select: { id: true, name: true, version: true },
  });
  const existingByName = new Map(existing.map((t) => [t.name, t]));

  const results: BulkImportItemResult[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      results.push({ ok: false, index: i, name: null, error: "Item is not an object" });
      continue;
    }
    const it = item as Record<string, unknown>;
    const nameRaw = it.name;
    if (typeof nameRaw !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nameRaw)) {
      results.push({
        ok: false,
        index: i,
        name: typeof nameRaw === "string" ? nameRaw : null,
        error: "Missing or invalid `name` (must be snake_case identifier)",
      });
      continue;
    }
    const name = nameRaw;
    const descRaw = it.description;
    if (typeof descRaw !== "string" || descRaw.length < 1) {
      results.push({ ok: false, index: i, name, error: "Missing `description`" });
      continue;
    }
    const params = it.parameters;
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      results.push({ ok: false, index: i, name, error: "`parameters` must be a JSON object" });
      continue;
    }
    // Extras we keep as locale presets: `stage` (init/extract/detect/...)
    // gives a useful grouping tag for downstream selection.
    const localePresets: string[] = [];
    if (typeof it.stage === "string" && it.stage.trim()) {
      localePresets.push(it.stage.trim().toLowerCase());
    }

    // Append `returns` to description (preserved verbatim) so the model
    // sees the expected return shape during function-calling — currently
    // we don't have a dedicated returns column on ToolDef.
    let description = descRaw;
    if (typeof it.returns === "string" && it.returns.trim()) {
      description = `${descRaw}\n\nReturns: ${it.returns.trim()}`;
    }

    const dup = existingByName.get(name);
    if (dup && parsed.data.mode === "skip") {
      skippedCount += 1;
      results.push({ ok: true, name, id: dup.id, action: "updated" });
      continue;
    }
    try {
      if (dup && parsed.data.mode === "overwrite") {
        const updated = await prisma.toolDef.update({
          where: { id: dup.id },
          data: {
            description,
            parameters: params as Prisma.InputJsonValue,
            localePresets,
            version: { increment: 1 },
          },
        });
        updatedCount += 1;
        results.push({ ok: true, name: updated.name, id: updated.id, action: "updated" });
      } else {
        const created = await prisma.toolDef.create({
          data: {
            catalogId: parsed.data.catalogId,
            name,
            description,
            parameters: params as Prisma.InputJsonValue,
            localePresets,
          },
        });
        createdCount += 1;
        results.push({ ok: true, name: created.name, id: created.id, action: "created" });
      }
    } catch (e) {
      results.push({ ok: false, index: i, name, error: (e as Error).message });
    }
  }

  await logAudit({
    projectId: parsed.data.projectId,
    actorUserId: user.id,
    action: "tool.bulk_import",
    targetKind: "ToolCatalog",
    targetId: parsed.data.catalogId,
    metadata: {
      total: raw.length,
      created: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
      failed: results.filter((r) => !r.ok).length,
      mode: parsed.data.mode,
    },
  });

  revalidatePath(`/projects/${parsed.data.projectId}/tools`);
  return {
    ok: true,
    total: raw.length,
    created: createdCount,
    updated: updatedCount,
    skipped: skippedCount,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
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
