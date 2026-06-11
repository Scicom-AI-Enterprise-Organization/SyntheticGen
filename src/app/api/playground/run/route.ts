import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { decryptSecret } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Playground request → upstream LLM. Streams the upstream response body
// straight through to the browser as SSE. We don't reshape events; the
// playground client deals with raw OpenAI-style deltas so the user can
// see exactly what the provider sent (tool_call fragments, reasoning,
// usage stats, etc.).
const runSchema = z.object({
  providerId: z.string(),
  model: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.string().nullable().optional(),
        // tool message extras (we accept them verbatim for replay scenarios)
        tool_call_id: z.string().optional(),
        name: z.string().optional(),
        tool_calls: z.array(z.unknown()).optional(),
      }),
    )
    .min(1),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().min(1).max(64000).optional(),
  seed: z.number().int().nullable().optional(),
  stream: z.boolean().default(true),
  // OpenAI tool catalog — passed verbatim. Validated by upstream.
  tools: z.array(z.unknown()).nullable().optional(),
  // "auto" | "required" | "none" | {type:"function",function:{name:string}}
  tool_choice: z.unknown().optional(),
  // OpenAI o-series / vLLM convention: "low" | "medium" | "high" | "minimal" | null
  reasoning_effort: z.string().nullable().optional(),
  // vLLM Qwen3-style chat-template kwargs. Sent verbatim when non-empty.
  chat_template_kwargs: z.record(z.string(), z.unknown()).nullable().optional(),
  // Extra raw key/value pairs the user might want to send (e.g. provider-
  // specific knobs). Merged INTO the payload last so the user can
  // override any of the structured fields above when needed.
  extra: z.record(z.string(), z.unknown()).nullable().optional(),
});

export async function POST(req: NextRequest) {
  await requireUser();
  let body: z.infer<typeof runSchema>;
  try {
    body = runSchema.parse(await req.json());
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `bad request: ${(e as Error).message}` }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const provider = await prisma.globalProviderCredential.findUnique({
    where: { id: body.providerId },
    select: {
      baseUrl: true,
      encryptedApiKey: true,
      headers: true,
      archivedAt: true,
    },
  });
  if (!provider || provider.archivedAt) {
    return new Response(
      JSON.stringify({ error: "provider not found or archived" }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }

  const apiKey = decryptSecret(Buffer.from(provider.encryptedApiKey));
  const url = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const upstreamHeaders: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (body.stream) upstreamHeaders["Accept"] = "text/event-stream";
  // Merge provider-level extra headers (e.g. custom proxy auth).
  if (provider.headers && typeof provider.headers === "object" && !Array.isArray(provider.headers)) {
    for (const [k, v] of Object.entries(provider.headers as Record<string, unknown>)) {
      if (typeof v === "string") upstreamHeaders[k] = v;
    }
  }

  // Build the upstream payload. We only include fields when set so the
  // upstream's defaults kick in for anything the user left blank.
  const payload: Record<string, unknown> = {
    model: body.model,
    messages: body.messages,
    stream: body.stream,
  };
  if (body.stream) payload.stream_options = { include_usage: true };
  if (body.max_tokens !== undefined) payload.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.top_p !== undefined) payload.top_p = body.top_p;
  if (body.seed !== undefined && body.seed !== null) payload.seed = body.seed;
  if (body.tools && Array.isArray(body.tools) && body.tools.length > 0) {
    // Auto-normalize tool shape: vLLM / OpenAI require each entry to be
    //   { type: "function", function: { name, description, parameters } }
    // but the natural "tool def" shape people paste from spec docs is
    //   { name, description, parameters, stage?, returns?, ... }
    // We accept either form here — already-wrapped entries pass through,
    // bare entries get wrapped and any extra fields (stage, returns) are
    // dropped. Without this the proxy returns 422 with one missing-field
    // error per tool. Tools that have no recognizable name field at all
    // pass through unchanged so a typo surfaces as a real error instead
    // of being silently rewritten.
    payload.tools = body.tools.map((t) => {
      if (!t || typeof t !== "object") return t;
      const obj = t as Record<string, unknown>;
      if (obj.type === "function" && obj.function && typeof obj.function === "object") {
        return obj;
      }
      if (typeof obj.name === "string") {
        return {
          type: "function",
          function: {
            name: obj.name,
            description: typeof obj.description === "string" ? obj.description : "",
            parameters:
              obj.parameters && typeof obj.parameters === "object"
                ? obj.parameters
                : { type: "object", properties: {} },
          },
        };
      }
      return obj;
    });
    payload.tool_choice = body.tool_choice ?? "auto";
  }
  if (body.reasoning_effort) payload.reasoning_effort = body.reasoning_effort;
  if (
    body.chat_template_kwargs &&
    Object.keys(body.chat_template_kwargs).length > 0
  ) {
    payload.chat_template_kwargs = body.chat_template_kwargs;
    if ("enable_thinking" in body.chat_template_kwargs) {
      payload.include_reasoning = Boolean(
        body.chat_template_kwargs.enable_thinking,
      );
    }
  }
  if (body.extra && Object.keys(body.extra).length > 0) {
    Object.assign(payload, body.extra);
  }

  // Open the upstream connection. We pass the body's stream flag along —
  // streaming is the default for the playground, but non-streaming JSON
  // works too (we wrap it as a single SSE event below).
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `connect failed: ${(e as Error).message}` }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, obj: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // First event: echo the request that landed upstream so the user
      // can see what we ACTUALLY sent (resolved URL, masked auth, full
      // payload). Helps debug provider-side rejections.
      send(controller, {
        event: "request",
        url,
        headers: {
          ...upstreamHeaders,
          Authorization: `Bearer ${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`,
        },
        payload,
      });

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        send(controller, {
          event: "error",
          status: upstream.status,
          body: text.slice(0, 4000),
        });
        send(controller, { event: "done", status: "failed" });
        controller.close();
        return;
      }

      if (!body.stream) {
        const text = await upstream.text();
        try {
          const json = JSON.parse(text);
          send(controller, { event: "json", payload: json });
        } catch {
          send(controller, { event: "raw", payload: text });
        }
        send(controller, { event: "done", status: "succeeded" });
        controller.close();
        return;
      }

      const reader = upstream.body?.getReader();
      if (!reader) {
        send(controller, { event: "error", body: "no upstream body" });
        send(controller, { event: "done", status: "failed" });
        controller.close();
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE frames are separated by blank lines. Process complete
          // frames + leave the trailing partial in the buffer.
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            // Each frame may have multiple `data:` lines. Concatenate them.
            const lines = frame.split("\n");
            const dataLines: string[] = [];
            for (const line of lines) {
              if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trimStart());
              }
            }
            if (dataLines.length === 0) continue;
            const data = dataLines.join("\n");
            if (data === "[DONE]") {
              send(controller, { event: "done", status: "succeeded" });
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              send(controller, { event: "chunk", payload: parsed });
            } catch {
              send(controller, { event: "raw", payload: data });
            }
          }
        }
      } catch (e) {
        send(controller, { event: "error", body: (e as Error).message });
      } finally {
        send(controller, { event: "done", status: "succeeded" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
