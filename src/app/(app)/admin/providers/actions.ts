"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { encryptSecret, decryptSecret, fingerprintApiKey } from "@/lib/crypto";

// JSON-typing shared with the project-side provider action so the chatTemplate
// kwargs schema accepts the same shapes ({ enable_thinking: false }, etc.).
const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const chatTemplateKwargsSchema = z.record(z.string().min(1), jsonValueSchema);
const reasoningEffortEnum = z.enum(["minimal", "low", "medium", "high"]);
const providerKindEnum = z.enum([
  "openai",
  "vllm",
  "together",
  "openrouter",
  "sglang",
  "anthropic-proxy",
  "custom",
]);

const createSchema = z.object({
  name: z.string().min(2).max(120),
  kind: providerKindEnum,
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  defaultModel: z.string().max(120).optional().nullable(),
  reasoningEffort: reasoningEffortEnum.optional().nullable(),
  chatTemplateKwargs: chatTemplateKwargsSchema.optional().nullable(),
});

const updateSchema = z.object({
  id: z.string(),
  name: z.string().min(2).max(120),
  kind: providerKindEnum,
  baseUrl: z.string().url(),
  apiKey: z.string().optional().nullable(),
  defaultModel: z.string().max(120).optional().nullable(),
  reasoningEffort: reasoningEffortEnum.optional().nullable(),
  chatTemplateKwargs: chatTemplateKwargsSchema.optional().nullable(),
});

const testSchema = z.object({
  id: z.string().optional().nullable(),
  baseUrl: z.string().url(),
  apiKey: z.string().optional().nullable(),
  model: z.string().min(1),
  reasoningEffort: reasoningEffortEnum.optional().nullable(),
  chatTemplateKwargs: chatTemplateKwargsSchema.optional().nullable(),
});

// One-shot chat completion against the provider so the admin can verify the
// credentials before saving. Mirrors testProviderConnection in the project
// providers action but gated on the global `providers:write` permission.
export async function testGlobalProviderConnection(
  input: z.infer<typeof testSchema>,
) {
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  await requirePermission("providers:write");

  let apiKey = parsed.data.apiKey?.trim() || null;
  if (!apiKey && parsed.data.id) {
    const existing = await prisma.globalProviderCredential.findUnique({
      where: { id: parsed.data.id },
      select: { encryptedApiKey: true },
    });
    if (!existing) return { error: "Provider not found" };
    try {
      apiKey = decryptSecret(Buffer.from(existing.encryptedApiKey));
    } catch (e) {
      return { error: `Could not decrypt stored key: ${(e as Error).message}` };
    }
  }
  if (!apiKey) return { error: "API key required" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const body: Record<string, unknown> = {
      model: parsed.data.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 8,
    };
    if (parsed.data.reasoningEffort) {
      body.reasoning_effort = parsed.data.reasoningEffort;
    }
    if (
      parsed.data.chatTemplateKwargs &&
      Object.keys(parsed.data.chatTemplateKwargs).length > 0
    ) {
      body.chat_template_kwargs = parsed.data.chatTemplateKwargs;
    }
    const res = await fetch(`${parsed.data.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true as const };
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") return { error: "Request timed out after 15s" };
    return { error: err.message || "Network error" };
  } finally {
    clearTimeout(timer);
  }
}

export async function createGlobalProvider(input: z.infer<typeof createSchema>) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  const user = await requirePermission("providers:write");

  let encrypted: Buffer;
  try {
    encrypted = encryptSecret(parsed.data.apiKey);
  } catch (e) {
    return { error: (e as Error).message };
  }

  const dup = await prisma.globalProviderCredential.findUnique({
    where: { name: parsed.data.name },
    select: { id: true },
  });
  if (dup) return { error: `A global provider named "${parsed.data.name}" already exists` };

  const created = await prisma.globalProviderCredential.create({
    data: {
      name: parsed.data.name,
      kind: parsed.data.kind,
      baseUrl: parsed.data.baseUrl,
      encryptedApiKey: new Uint8Array(encrypted),
      keyFingerprint: fingerprintApiKey(parsed.data.apiKey),
      defaultModel: parsed.data.defaultModel ?? null,
      reasoningEffort: parsed.data.reasoningEffort ?? null,
      chatTemplateKwargs:
        parsed.data.chatTemplateKwargs && Object.keys(parsed.data.chatTemplateKwargs).length > 0
          ? (parsed.data.chatTemplateKwargs as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      createdById: user.id,
    },
  });

  revalidatePath("/admin/providers");
  return { ok: true as const, id: created.id };
}

export async function updateGlobalProvider(input: z.infer<typeof updateSchema>) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? "Invalid input" };
  await requirePermission("providers:write");

  const existing = await prisma.globalProviderCredential.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, name: true },
  });
  if (!existing) return { error: "Global provider not found" };

  // Uniqueness on name — block rename collisions.
  if (parsed.data.name !== existing.name) {
    const conflict = await prisma.globalProviderCredential.findUnique({
      where: { name: parsed.data.name },
      select: { id: true },
    });
    if (conflict)
      return { error: `A global provider named "${parsed.data.name}" already exists` };
  }

  const data: Prisma.GlobalProviderCredentialUpdateInput = {
    name: parsed.data.name,
    kind: parsed.data.kind,
    baseUrl: parsed.data.baseUrl,
    defaultModel: parsed.data.defaultModel ?? null,
    reasoningEffort: parsed.data.reasoningEffort ?? null,
    chatTemplateKwargs:
      parsed.data.chatTemplateKwargs && Object.keys(parsed.data.chatTemplateKwargs).length > 0
        ? (parsed.data.chatTemplateKwargs as Prisma.InputJsonValue)
        : Prisma.JsonNull,
  };

  const newKey = parsed.data.apiKey?.trim();
  if (newKey) {
    let encrypted: Buffer;
    try {
      encrypted = encryptSecret(newKey);
    } catch (e) {
      return { error: (e as Error).message };
    }
    data.encryptedApiKey = new Uint8Array(encrypted);
    data.keyFingerprint = fingerprintApiKey(newKey);
  }

  await prisma.globalProviderCredential.update({
    where: { id: parsed.data.id },
    data,
  });

  revalidatePath("/admin/providers");
  return { ok: true as const };
}

export async function deleteGlobalProvider(id: string) {
  await requirePermission("providers:write");
  // Imports point at this with onDelete: SetNull so project copies survive
  // — they just lose the "this came from global X" trace.
  await prisma.globalProviderCredential.delete({ where: { id } });
  revalidatePath("/admin/providers");
  return { ok: true as const };
}
