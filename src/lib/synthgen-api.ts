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

export async function executeJob(jobId: string): Promise<{ ok: boolean }> {
  return call(`/internal/jobs/${jobId}/execute`, { method: "POST" });
}

// Cancel the in-flight asyncio task for this job in the Python worker
// process. Best-effort — if the task already finished or never registered
// (e.g. job was only pending), Python returns ok with cancelled=0. Use
// this AFTER updating the DB row so the SSE picks up the new status.
export async function cancelJobTask(
  jobId: string,
): Promise<{ ok: boolean; cancelled?: number }> {
  return call(`/internal/jobs/${jobId}/cancel-task`, { method: "POST" });
}

export type AiAssistKind =
  | "persona"
  | "taxonomy-node"
  | "language-profile"
  | "prompt-template"
  | "tool-def"
  | "flow-graph"
  | "benchmark-rubric";

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

// Streaming variant of aiAssist. Reads NDJSON from /internal/ai-assist/stream;
// each line is `{ type: "delta" | "done" | "error", ... }`. onToken is called
// with text fragments as they arrive; the final parsed `data` payload is
// returned by the promise on type=done. Throws on type=error or non-2xx.
export async function aiAssistStream(
  input: {
    kind: AiAssistKind;
    prompt: string;
    providerId: string;
    model?: string | null;
    extraContext?: string | null;
    maxTokens?: number | null;
    temperature?: number | null;
  },
  onToken: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE_URL}/internal/ai-assist/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": INTERNAL_TOKEN,
    },
    body: JSON.stringify({
      kind: input.kind,
      prompt: input.prompt,
      providerId: input.providerId,
      model: input.model ?? null,
      extraContext: input.extraContext ?? null,
      maxTokens: input.maxTokens ?? null,
      temperature: input.temperature ?? null,
    }),
    cache: "no-store",
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `synthgen-api /internal/ai-assist/stream -> ${res.status}: ${body.slice(0, 300)}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finalData: Record<string, unknown> | null = null;
  let errorMsg: string | null = null;

  outer: while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (evt.type === "delta") {
        const content =
          typeof evt.content === "string"
            ? evt.content
            : typeof evt.text === "string"
              ? evt.text
              : "";
        if (content) onToken(content);
      } else if (evt.type === "done") {
        finalData = (evt.data as Record<string, unknown>) ?? {};
        break outer;
      } else if (evt.type === "error") {
        errorMsg = typeof evt.error === "string" ? evt.error : "stream error";
        break outer;
      }
    }
  }

  if (errorMsg) throw new Error(errorMsg);
  if (!finalData) {
    throw new Error("stream closed without a `done` event");
  }
  return finalData;
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
