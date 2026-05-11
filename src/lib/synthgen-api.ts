// Thin client for the Python synthgen service.
// Used from Server Actions to delegate all science/domain logic.

const BASE_URL = process.env.SYNTHGEN_API_URL ?? "http://localhost:8000";
const INTERNAL_TOKEN = process.env.SYNTHGEN_INTERNAL_TOKEN ?? "";

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-token": INTERNAL_TOKEN,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`synthgen-api ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

export async function bootstrapProjectDefaults(projectId: string): Promise<{ created: number }> {
  return call(`/internal/projects/${projectId}/bootstrap`, { method: "POST" });
}

export async function startRun(runId: string): Promise<{ ok: boolean }> {
  return call(`/internal/runs/${runId}/start`, { method: "POST" });
}

export async function cancelRun(runId: string): Promise<{ ok: boolean }> {
  return call(`/internal/runs/${runId}/cancel`, { method: "POST" });
}

export async function buildExport(exportId: string): Promise<{ ok: boolean }> {
  return call(`/internal/exports/${exportId}/build`, { method: "POST" });
}

export type AiAssistKind =
  | "persona"
  | "taxonomy-node"
  | "language-profile"
  | "prompt-template"
  | "tool-def"
  | "flow-graph";

export interface AiAssistResult {
  ok: boolean;
  data: Record<string, unknown>;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
}

export async function aiAssist(input: {
  kind: AiAssistKind;
  prompt: string;
  providerId: string;
  model?: string | null;
  extraContext?: string | null;
  maxTokens?: number | null;
}): Promise<AiAssistResult> {
  return call("/internal/ai-assist", {
    method: "POST",
    body: JSON.stringify({
      kind: input.kind,
      prompt: input.prompt,
      providerId: input.providerId,
      model: input.model ?? null,
      extraContext: input.extraContext ?? null,
      maxTokens: input.maxTokens ?? null,
    }),
  });
}

/** Best-effort wrapper — logs but never throws, used when failure should not block the UI flow. */
export async function tryCall<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[synthgen-api] ${label} failed: ${(e as Error).message}`);
    return null;
  }
}
