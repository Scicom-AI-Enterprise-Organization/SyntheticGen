import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";

const bodySchema = z.object({
  providerId: z.string(),
  description: z.string().min(3).max(2000),
  extraContext: z.string().max(16000).optional().nullable(),
  maxTokens: z.number().int().min(64).max(8000).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const user = await requireUser();

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
  }

  // Same gate as ai-assist: any "write" perm implies you can ask for a draft.
  const perm = await checkProjectPermission(user, projectId, "personas.write");
  if (!perm.ok) {
    return Response.json({ error: perm.reason }, { status: 403 });
  }

  const provider = await prisma.providerCredential.findUnique({
    where: { id: parsed.data.providerId },
    select: { projectId: true },
  });
  if (!provider || provider.projectId !== projectId) {
    return Response.json({ error: "provider not found in this project" }, { status: 404 });
  }

  const baseUrl = process.env.SYNTHGEN_API_URL ?? "http://localhost:8000";
  const internalToken = process.env.SYNTHGEN_INTERNAL_TOKEN ?? "";
  const wantStream = new URL(req.url).searchParams.get("stream") === "1";
  const upstreamPath = wantStream
    ? "/internal/random-prompt/stream"
    : "/internal/random-prompt";

  try {
    const upstream = await fetch(`${baseUrl}${upstreamPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": internalToken,
      },
      body: JSON.stringify({
        providerId: parsed.data.providerId,
        description: parsed.data.description,
        extraContext: parsed.data.extraContext ?? null,
        maxTokens: parsed.data.maxTokens ?? null,
      }),
      cache: "no-store",
      signal: req.signal,
    });

    if (wantStream) {
      if (!upstream.ok || !upstream.body) {
        const body = await upstream.text().catch(() => "");
        return Response.json(
          { error: body.slice(0, 500) || `upstream ${upstream.status}` },
          { status: upstream.status || 502 },
        );
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "content-type": "application/x-ndjson",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        },
      });
    }

    const text = await upstream.text();
    if (!upstream.ok) {
      return Response.json(
        { error: text.slice(0, 500) || `upstream ${upstream.status}` },
        { status: upstream.status || 502 },
      );
    }
    return new Response(text, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message ?? "random-prompt failed" }, { status: 502 });
  }
}
