import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";
import { aiAssist, type AiAssistKind } from "@/lib/synthgen-api";

export const runtime = "nodejs";

const KIND_TO_ACTION = {
  persona: "personas.write",
  "taxonomy-node": "taxonomy.write",
  "language-profile": "languages.write",
  "prompt-template": "templates.write",
  "tool-def": "tools.write",
  "flow-graph": "flows.write",
} as const;

const bodySchema = z.object({
  kind: z.enum([
    "persona",
    "taxonomy-node",
    "language-profile",
    "prompt-template",
    "tool-def",
    "flow-graph",
  ]),
  prompt: z.string().min(3).max(4000),
  providerId: z.string(),
  model: z.string().optional().nullable(),
  // flow-graph passes the project's tool catalog as extraContext, which can be larger.
  extraContext: z.string().max(16000).optional().nullable(),
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

  const action = KIND_TO_ACTION[parsed.data.kind];
  const perm = await checkProjectPermission(user, projectId, action);
  if (!perm.ok) {
    return Response.json({ error: perm.reason }, { status: 403 });
  }

  // Confirm the requested provider belongs to this project (defence in depth).
  const provider = await prisma.providerCredential.findUnique({
    where: { id: parsed.data.providerId },
    select: { projectId: true },
  });
  if (!provider || provider.projectId !== projectId) {
    return Response.json({ error: "provider not found in this project" }, { status: 404 });
  }

  try {
    const result = await aiAssist({
      kind: parsed.data.kind as AiAssistKind,
      prompt: parsed.data.prompt,
      providerId: parsed.data.providerId,
      model: parsed.data.model ?? null,
      extraContext: parsed.data.extraContext ?? null,
    });
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: (e as Error).message ?? "ai-assist failed" },
      { status: 502 },
    );
  }
}
