"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, KeyRound, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// REST reference — three-column layout: searchable endpoint nav on the left,
// per-endpoint sections in the main column, each split into docs + samples.
// Samples track the real route shapes; if you change a route's wire shape,
// update its entry in ENDPOINTS below.

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute right-1.5 top-1.5 h-6 w-6 opacity-50 hover:opacity-100"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title={copied ? "Copied" : "Copy"}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function CodeBlock({
  children,
  label,
}: {
  children: string;
  label?: string;
}) {
  return (
    <div className="relative rounded-md border border-border bg-muted p-3">
      {label && (
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      )}
      <pre className="overflow-x-auto pr-8 font-mono text-xs leading-relaxed text-foreground/90">
        {children}
      </pre>
      <CopyBtn text={children} />
    </div>
  );
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function MethodBadge({
  method,
  size = "sm",
}: {
  method: Method;
  size?: "sm" | "xs";
}) {
  const colour =
    method === "GET"
      ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
      : method === "POST"
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
        : method === "PUT"
          ? "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200"
          : method === "PATCH"
            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
            : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
  const sizing =
    size === "xs" ? "h-4 px-1 text-[9px]" : "h-5 px-1.5 text-[10px]";
  return (
    <span
      className={
        "inline-flex items-center rounded font-mono font-semibold tracking-wider " +
        sizing +
        " " +
        colour
      }
    >
      {method}
    </span>
  );
}

function StatusBadge({ code, label }: { code: number; label: string }) {
  const ok = code >= 200 && code < 300;
  const colour = ok
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
    : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200";
  return (
    <span
      className={
        "inline-flex h-5 items-center rounded px-1.5 font-mono text-[10px] font-semibold " +
        colour
      }
    >
      {code} {label}
    </span>
  );
}

interface Endpoint {
  id: string;
  group: string;
  method: Method;
  path: string;
  title: string;
  description: React.ReactNode;
  parameters?: Array<{
    name: string;
    in: "query" | "body" | "path";
    type: string;
    required?: boolean;
    doc: React.ReactNode;
  }>;
  request: { sample: string };
  responses: Array<{
    code: number;
    codeLabel: string;
    doc?: React.ReactNode;
    sample: string;
  }>;
}

interface Group {
  id: string;
  title: string;
  blurb?: React.ReactNode;
}

const GROUPS: Group[] = [
  {
    id: "apikeys",
    title: "API tokens",
    blurb: (
      <>
        Mint and revoke the <code>sgk_…</code> bearer tokens these endpoints
        authenticate with. The token is shown <strong>exactly once</strong> at
        creation — only its sha256 hash is stored.
      </>
    ),
  },
  {
    id: "projects",
    title: "Projects",
    blurb: (
      <>
        Top-level workspace for an enterprise synthetic-data project. Every
        other resource (runs, personas, templates, tools…) belongs to one.
      </>
    ),
  },
  {
    id: "bootstrap",
    title: "Bootstrap",
    blurb: (
      <>
        One call seeds a whole project: a background orchestrator fans out
        AI-assist calls to generate taxonomy, language profiles, personas,
        templates, tools, flows, rubrics, and a benchmark. Append-only and
        single-flight — at most one bootstrap runs per project at a time.
        Requires the <code>project.update</code> role (OWNER / admin).
      </>
    ),
  },
  {
    id: "taxonomy",
    title: "Taxonomy",
    blurb: (
      <>
        Topic nodes — the primary grid axis of a generation run. List them to
        discover the <code>taxonomyNodeIds</code> that <code>POST /runs</code>{" "}
        requires. Slice 1 is a flat tree.
      </>
    ),
  },
  {
    id: "runs",
    title: "Generation runs",
    blurb: (
      <>
        Kick off a synthetic-conversation generation, inspect its frozen config,
        and walk its conversations.
      </>
    ),
  },
  {
    id: "conversations",
    title: "Conversations",
    blurb: (
      <>
        Read a single conversation end-to-end — every message including
        reasoning content + tool calls, plus per-conversation validations.
      </>
    ),
  },
  {
    id: "providers",
    title: "Providers",
    blurb: (
      <>
        LLM provider credentials (base URL + API key + reasoning controls). A
        run picks one to call. API keys are AES-256-GCM encrypted at rest.
      </>
    ),
  },
  {
    id: "personas",
    title: "Personas",
    blurb: (
      <>
        Synthetic-user personas the generator role-plays from — demographics,
        register, dialect.
      </>
    ),
  },
  {
    id: "templates",
    title: "Templates",
    blurb: (
      <>
        Prompt templates: <code>system</code> templates for the assistant,
        <code>user-seed</code> templates for the opening user message,{" "}
        <code>judge</code> for benchmarks, <code>conversation-driver</code> for
        multi-turn steering.
      </>
    ),
  },
  {
    id: "languages",
    title: "Language profiles",
    blurb: (
      <>
        Locale + register policy (ms/en/zh/ta, formal/colloquial,
        code-switch policy, banned-token lists).
      </>
    ),
  },
  {
    id: "tools",
    title: "Tools",
    blurb: (
      <>
        OpenAI-shape function definitions a synthetic assistant can be allowed
        to call. Stored in a <code>ToolCatalog</code>; the catalog is
        auto-created if you don&apos;t pass one.
      </>
    ),
  },
  {
    id: "flows",
    title: "Flows",
    blurb: (
      <>
        Multi-turn conversation DAGs (system / user / action / branch nodes).
        Lets a run produce structured multi-turn traces instead of one-shot
        Q&A grids.
      </>
    ),
  },
  {
    id: "rubrics",
    title: "Rubrics",
    blurb: (
      <>
        Multi-axis scoring rubrics (axes with name, description, scale,
        weight) used by benchmark judges.
      </>
    ),
  },
  {
    id: "benchmarks",
    title: "Benchmarks",
    blurb: (
      <>
        Freeze a set of conversations into a <code>project-chat-replay</code>{" "}
        benchmark, then run a candidate model against it and score with an
        ensemble of LLM judges. Run control mirrors generation runs
        (start/cancel/restart).
      </>
    ),
  },
  {
    id: "ensemble-groups",
    title: "Ensemble judge groups",
    blurb: (
      <>
        A named list of <code>{`{providerCredentialId, model}`}</code> judges.
        A chat-replay benchmark run scores against one group — size 1 is a
        single judge, 2+ produces per-row consensus. Required to start a
        chat-replay run.
      </>
    ),
  },
  {
    id: "datasets",
    title: "Datasets",
    blurb: (
      <>
        Freeze a filtered set of conversations into an immutable, versioned{" "}
        <code>DatasetVersion</code> (delete-protected), then download it as
        JSONL/JSON. The platform&apos;s release artifact.
      </>
    ),
  },
  {
    id: "knowledge",
    title: "Knowledge base",
    blurb: (
      <>
        Grounding documents (title + content + tags + taxonomy links) the
        generator can reference. Create one at a time or in bulk.
      </>
    ),
  },
];

const ENDPOINTS: Endpoint[] = [
  // ───── API tokens (web-only, not v1) ─────
  {
    id: "list-api-keys",
    group: "apikeys",
    method: "GET",
    path: "/api/api-keys",
    title: "List your tokens",
    description: (
      <>
        Returns every non-revoked token you&apos;ve minted. The raw secret is
        never returned — only the <code>prefix</code> for display.
      </>
    ),
    request: {
      sample: `curl -s "$SGEN/api/api-keys" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
    },
    responses: [
      {
        code: 200,
        codeLabel: "OK",
        sample: `[
  {
    "id": "cmq9...",
    "name": "agent-debug",
    "prefix": "sgk_AbCd1234",
    "createdAt": "2026-06-12T07:00:00.000Z",
    "lastUsedAt": "2026-06-12T07:30:12.000Z"
  }
]`,
      },
    ],
  },
  {
    id: "create-api-key",
    group: "apikeys",
    method: "POST",
    path: "/api/api-keys",
    title: "Mint a new token",
    description: (
      <>
        Returns the full plaintext <code>raw</code> exactly once. Copy it now —
        the server only retains <code>sha256(raw)</code>. The token inherits
        your role + project memberships.
      </>
    ),
    parameters: [
      {
        name: "name",
        in: "body",
        type: "string",
        required: true,
        doc: "Label, e.g. agent-debug, laptop, ci-bot.",
      },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/api-keys" \\
  -H "Authorization: Bearer $SGEN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "agent-debug"}'`,
    },
    responses: [
      {
        code: 201,
        codeLabel: "Created",
        sample: `{
  "id": "cmq9...",
  "name": "agent-debug",
  "prefix": "sgk_AbCd1234",
  "createdAt": "2026-06-12T07:00:00.000Z",
  "raw": "sgk_AbCd1234EfGh5678IjKl9012MnOp3456"
}`,
      },
    ],
  },
  {
    id: "revoke-api-key",
    group: "apikeys",
    method: "DELETE",
    path: "/api/api-keys/:id",
    title: "Revoke a token",
    description: (
      <>
        Soft-revoke (sets <code>revokedAt</code>). Takes effect immediately —
        next request using the token returns 401.
      </>
    ),
    parameters: [
      {
        name: "id",
        in: "path",
        type: "string",
        required: true,
        doc: "The token's id (cmq…), NOT the raw secret.",
      },
    ],
    request: {
      sample: `curl -s -X DELETE "$SGEN/api/api-keys/cmq9..." \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
    },
    responses: [
      { code: 200, codeLabel: "OK", sample: `{ "ok": true }` },
    ],
  },

  // ───── Projects ─────
  {
    id: "list-projects",
    group: "projects",
    method: "GET",
    path: "/api/v1/projects",
    title: "List your projects",
    description: (
      <>
        Every project you&apos;re a member of, with your role per project.
        Used by an agent to discover what project ids it can act on.
      </>
    ),
    request: {
      sample: `curl -s "$SGEN/api/v1/projects" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
    },
    responses: [
      {
        code: 200,
        codeLabel: "OK",
        sample: `{
  "projects": [
    {
      "id": "cmq8z18ks0001wn44d0mvv6t0",
      "name": "Reconciliation MY",
      "slug": "reconciliation-my",
      "role": "OWNER",
      "createdAt": "2026-05-01T00:00:00.000Z"
    }
  ]
}`,
      },
    ],
  },
  {
    id: "create-project",
    group: "projects",
    method: "POST",
    path: "/api/v1/projects",
    title: "Create a project",
    description: (
      <>
        Requires the org permission <code>projects:write</code>. The caller
        becomes the project <code>OWNER</code>. Best-effort triggers default
        LanguageProfile seeding through the worker.
      </>
    ),
    parameters: [
      {
        name: "name",
        in: "body",
        type: "string",
        required: true,
        doc: "Display name, 2-120 chars.",
      },
      {
        name: "description",
        in: "body",
        type: "string",
        doc: "Optional, up to 500 chars.",
      },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects" \\
  -H "Authorization: Bearer $SGEN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Reconciliation MY"}'`,
    },
    responses: [
      {
        code: 201,
        codeLabel: "Created",
        sample: `{
  "ok": true,
  "project": { "id": "cmq...", "name": "Reconciliation MY", "slug": "reconciliation-my" },
  "bootstrapWarning": null
}`,
      },
    ],
  },

  {
    id: "get-project",
    group: "projects",
    method: "GET",
    path: "/api/v1/projects/:projectId",
    title: "Project detail",
    description: <>Project fields, your <code>role</code>, and per-resource <code>counts</code> (personas, templates, tools, runs, conversations, benchmarks, datasets…).</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "project": { "id": "...", "name": "...", "slug": "...", "role": "OWNER", "counts": { "personas": 9, "runs": 7, "conversations": 194, "benchmarks": 1 } } }` }],
  },
  {
    id: "update-project",
    group: "projects",
    method: "PATCH",
    path: "/api/v1/projects/:projectId",
    title: "Update a project",
    description: <>Partial update of <code>name</code>, <code>description</code>, <code>defaultFormality</code>, <code>labelingBaseUrl</code>. Requires <code>project.update</code>. (Labeling secrets aren&apos;t settable via API.)</>,
    parameters: [
      { name: "name", in: "body", type: "string", doc: "2-120 chars." },
      { name: "description", in: "body", type: "string", doc: "≤500 chars, null to clear." },
      { name: "defaultFormality", in: "body", type: '"formal" | "semi-formal" | "colloquial" | "mixed"', doc: "Project default register." },
    ],
    request: {
      sample: `curl -s -X PATCH "$SGEN/api/v1/projects/$PROJECT" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "description": "Updated brief" }'`,
    },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "ok": true, "project": { "id": "...", "name": "...", "defaultFormality": "formal" } }` }],
  },
  {
    id: "archive-project",
    group: "projects",
    method: "DELETE",
    path: "/api/v1/projects/:projectId",
    title: "Archive a project",
    description: <>Soft-delete (sets <code>archivedAt</code>). Requires <code>project.delete</code>.</>,
    request: { sample: `curl -s -X DELETE "$SGEN/api/v1/projects/$PROJECT" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "ok": true, "id": "...", "archived": true }` }],
  },
  {
    id: "list-members",
    group: "projects",
    method: "GET",
    path: "/api/v1/projects/:projectId/members",
    title: "List / manage members",
    description: <>List members + roles, <code>POST</code> to add or re-role one by email, <code>DELETE …/members/:userId</code> to remove (refuses the last OWNER). All require <code>members.manage</code>.</>,
    parameters: [
      { name: "email", in: "body", type: "string", doc: "POST: existing user's email." },
      { name: "role", in: "body", type: '"OWNER" | "EDITOR" | "ANNOTATOR" | "VIEWER"', doc: "POST: role to grant." },
    ],
    request: {
      sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/members" -H "Authorization: Bearer $SGEN_TOKEN"

curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/members" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "email": "teammate@corp.com", "role": "EDITOR" }'`,
    },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "members": [{ "userId": "...", "email": "...", "role": "OWNER" }] }` }],
  },

  // ───── Bootstrap ─────
  {
    id: "start-bootstrap",
    group: "bootstrap",
    method: "POST",
    path: "/api/v1/projects/:projectId/bootstrap",
    title: "Start a bootstrap",
    description: (
      <>
        Creates a <code>BootstrapJob</code> and fires the orchestrator
        (fire-and-forget). Returns immediately with the job id — poll{" "}
        <code>GET …/bootstrap/:jobId</code> until <code>status</code> is
        terminal. Omit <code>scope</code> to generate everything; pass a partial{" "}
        <code>scope</code> to opt in to only the phases you set <code>true</code>
        . Rejects with <strong>409</strong> if a bootstrap is already in flight.
      </>
    ),
    parameters: [
      { name: "prompt", in: "body", type: "string", required: true, doc: "Domain brief, 8..4000 chars — describes the project to seed." },
      { name: "providerId", in: "body", type: "string", required: true, doc: "ProviderCredential id (must belong to this project)." },
      { name: "model", in: "body", type: "string", doc: "Model override; falls back to the provider default when omitted." },
      { name: "temperature", in: "body", type: "number", doc: "0..2. Omit to use the per-kind default." },
      { name: "maxTokens", in: "body", type: "number", doc: "256..64000. Omit to use the per-kind default." },
      { name: "scope", in: "body", type: "object", doc: "Per-phase booleans: taxonomy, languages, personas, templates, tools, flows, rubrics, benchmarks, useExistingToolsContext. Omit for all-on." },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/bootstrap" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Malaysian retail-bank customer support — formal Bahasa baku plus casual Manglish; billing, account access, fraud, product queries.",
    "providerId": "$PROVIDER",
    "scope": { "taxonomy": true, "personas": true, "templates": true }
  }'`,
    },
    responses: [
      {
        code: 201,
        codeLabel: "Created",
        sample: `{
  "ok": true,
  "job": {
    "id": "cmqb...",
    "status": "queued",
    "scope": { "taxonomy": true, "personas": true, "templates": true, "languages": false, "tools": false, "flows": false, "rubrics": false, "benchmarks": false }
  }
}`,
      },
      {
        code: 409,
        codeLabel: "Conflict",
        doc: "A bootstrap is already running for this project.",
        sample: `{ "error": "A bootstrap job is already running for this project...", "runningJobId": "cmqb..." }`,
      },
    ],
  },
  {
    id: "get-bootstrap",
    group: "bootstrap",
    method: "GET",
    path: "/api/v1/projects/:projectId/bootstrap",
    title: "Bootstrap snapshot",
    description: (
      <>
        The live (or most-recent) job as <code>current</code>, plus up to 10
        finished jobs in <code>recent</code>, newest first. Each summary carries
        status, scope, per-step <code>inserted</code> counts, an{" "}
        <code>eventCount</code> (not the full trace), and timestamps.
      </>
    ),
    request: {
      sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/bootstrap" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
    },
    responses: [
      {
        code: 200,
        codeLabel: "OK",
        sample: `{
  "current": {
    "id": "cmqb...",
    "status": "running",
    "currentStep": "personas",
    "scope": { "taxonomy": true, "personas": true },
    "inserted": { "taxonomy": 8, "personas": 2 },
    "insertedTotal": 10,
    "eventCount": 23,
    "error": null,
    "createdAt": "...", "startedAt": "...", "completedAt": null
  },
  "recent": []
}`,
      },
    ],
  },
  {
    id: "get-bootstrap-job",
    group: "bootstrap",
    method: "GET",
    path: "/api/v1/projects/:projectId/bootstrap/:jobId",
    title: "Bootstrap job detail",
    description: (
      <>
        Full job incl. the durable <code>events</code> trace — the polling
        equivalent of the UI&apos;s SSE stream. Loop until <code>status</code>{" "}
        is <code>completed</code> / <code>failed</code> / <code>cancelled</code>
        ; inserted entity ids live on the <code>inserted</code> events.
      </>
    ),
    request: {
      sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/bootstrap/$JOB" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
    },
    responses: [
      {
        code: 200,
        codeLabel: "OK",
        sample: `{
  "job": {
    "id": "cmqb...",
    "status": "completed",
    "prompt": "Malaysian retail-bank customer support...",
    "providerId": "cmqa...",
    "model": null,
    "scope": { "taxonomy": true, "personas": true },
    "currentStep": null,
    "inserted": { "taxonomy": 8, "personas": 4 },
    "error": null,
    "events": [
      { "idx": 0, "ts": "...", "step": "init", "kind": "step-start" },
      { "idx": 1, "ts": "...", "step": "taxonomy", "kind": "inserted", "payload": { "entityId": "cmqb...", "name": "Billing & Payments" } }
    ],
    "createdAt": "...", "startedAt": "...", "completedAt": "..."
  }
}`,
      },
    ],
  },
  {
    id: "cancel-bootstrap",
    group: "bootstrap",
    method: "POST",
    path: "/api/v1/projects/:projectId/bootstrap/:jobId/cancel",
    title: "Cancel a bootstrap",
    description: (
      <>
        Flips a queued/running job to <code>cancelled</code>. There&apos;s no
        hard interrupt — the in-flight phase finishes, but the orchestrator
        stops at the next phase boundary. Returns <strong>409</strong> on an
        already-terminal job.
      </>
    ),
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/bootstrap/$JOB/cancel" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
    },
    responses: [
      { code: 200, codeLabel: "OK", sample: `{ "ok": true, "job": { "id": "cmqb...", "status": "cancelled" } }` },
      {
        code: 409,
        codeLabel: "Conflict",
        doc: "Job already reached a terminal status.",
        sample: `{ "error": "Cannot cancel a completed job" }`,
      },
    ],
  },

  // ───── Taxonomy ─────
  {
    id: "list-taxonomy",
    group: "taxonomy",
    method: "GET",
    path: "/api/v1/projects/:projectId/taxonomy",
    title: "List taxonomy nodes",
    description: (
      <>
        Every node across the project&apos;s taxonomies, plus the taxonomies
        themselves. The node <code>id</code>s are what <code>POST /runs</code>{" "}
        takes as <code>taxonomyNodeIds</code>.
      </>
    ),
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/taxonomy" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [
      { code: 200, codeLabel: "OK", sample: `{ "taxonomies": [{ "id": "...", "name": "default" }], "taxonomyNodes": [{ "id": "...", "taxonomyId": "...", "name": "Billing & Payments", "slug": "billing-payments", "path": "/billing-payments", "depth": 1 }] }` },
    ],
  },
  {
    id: "create-taxonomy",
    group: "taxonomy",
    method: "POST",
    path: "/api/v1/projects/:projectId/taxonomy",
    title: "Create a taxonomy node",
    description: <>Creates a flat (slice-1) node. <code>taxonomyId</code> is optional — omit to use (or auto-create) the project&apos;s default taxonomy. 409 on duplicate name.</>,
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "Node label, 1-120 chars." },
      { name: "taxonomyId", in: "body", type: "string", doc: "Defaults to the project's first taxonomy (auto-created)." },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/taxonomy" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "name": "Fraud & Security" }'`,
    },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "taxonomyNode": { "id": "...", "name": "Fraud & Security", "slug": "fraud-security", "path": "/fraud-security", "depth": 1 } }` }],
  },
  {
    id: "delete-taxonomy",
    group: "taxonomy",
    method: "DELETE",
    path: "/api/v1/projects/:projectId/taxonomy/:nodeId",
    title: "Delete a taxonomy node",
    description: <>Cascades children + run/conversation link rows.</>,
    request: { sample: `curl -s -X DELETE "$SGEN/api/v1/projects/$PROJECT/taxonomy/$NODE" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "ok": true, "id": "..." }` }],
  },

  // ───── Runs ─────
  {
    id: "list-runs",
    group: "runs",
    method: "GET",
    path: "/api/v1/projects/:projectId/runs",
    title: "List generation runs",
    description: (
      <>
        Recent runs, newest first. Supports <code>?limit</code> (default 20,
        max 200) and <code>?status</code> (e.g. <code>running</code>,{" "}
        <code>succeeded</code>, <code>failed</code>).
      </>
    ),
    parameters: [
      { name: "limit", in: "query", type: "number", doc: "Default 20, max 200." },
      { name: "status", in: "query", type: "string", doc: "Filter by status." },
    ],
    request: {
      sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/runs?limit=5" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
    },
    responses: [
      {
        code: 200,
        codeLabel: "OK",
        sample: `{
  "runs": [
    {
      "id": "cmq9h8hx1007ewn44pzagc9eb",
      "name": "Run 2026-06-11 12:00",
      "status": "succeeded",
      "model": "qwen/qwen3.6-27b",
      "targetCount": 1,
      "producedCount": 1,
      "acceptedCount": 1,
      "tokensIn": 19287,
      "tokensOut": 18243,
      "startedAt": "...",
      "completedAt": "...",
      "createdAt": "...",
      "formalityPolicy": "inherit"
    }
  ]
}`,
      },
    ],
  },
  {
    id: "get-run",
    group: "runs",
    method: "GET",
    path: "/api/v1/projects/:projectId/runs/:runId",
    title: "Run detail",
    description: (
      <>
        Frozen <code>configSnapshot</code>, <code>samplingParams</code>,{" "}
        <code>gridSpec</code>, resolved taxonomy/persona names, a count of
        jobs grouped by status, and the 50 most recent conversations.
      </>
    ),
    request: {
      sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/runs/$RUN" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
    },
    responses: [
      {
        code: 200,
        codeLabel: "OK",
        sample: `{
  "run": {
    "id": "cmq9h8hx1007ewn44pzagc9eb",
    "name": "...",
    "status": "succeeded",
    "model": "qwen/qwen3.6-27b",
    "samplingParams": { "temperature": 0.7, "max_tokens": 8192, "turns": 3, "includeReasoning": true },
    "gridSpec": { "personaIds": ["..."], "taxonomyNodeIds": ["..."], "rowsPerCell": 1 },
    "configSnapshot": { /* full frozen config */ },
    "taxonomyNodeNames": ["..."],
    "personaNames": ["..."]
  },
  "jobCounts": { "succeeded": 1 },
  "conversations": [
    { "id": "c00mq9jpty502ib6i1mstadec", "status": "accepted", "turnCount": 3, "tokenCount": 19283, "primaryLanguage": "ms", "createdAt": "..." }
  ]
}`,
      },
    ],
  },
  {
    id: "create-run",
    group: "runs",
    method: "POST",
    path: "/api/v1/projects/:projectId/runs",
    title: "Create + start a run",
    description: (
      <>
        Same input shape as the <Link className="font-medium underline-offset-2 hover:underline" href={`/projects`}>{`/runs/new`}</Link>{" "}
        wizard. The run is materialized into <code>GenerationJob</code> rows
        and the worker is signalled to start. Returns JSON (no redirect).
      </>
    ),
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "Run label." },
      { name: "templateId", in: "body", type: "string", required: true, doc: "PromptTemplate id." },
      { name: "languageProfileId", in: "body", type: "string", required: true, doc: "LanguageProfile id." },
      { name: "providerCredentialId", in: "body", type: "string", required: true, doc: "ProviderCredential id." },
      { name: "model", in: "body", type: "string", required: true, doc: "Model name override (e.g. qwen/qwen3.6-27b)." },
      { name: "personaIds", in: "body", type: "string[]", required: true, doc: "1..N persona ids — required." },
      { name: "taxonomyNodeIds", in: "body", type: "string[]", doc: "Required unless flowIds is non-empty." },
      { name: "flowIds", in: "body", type: "string[]", doc: "Non-empty switches to flow-driven mode." },
      { name: "toolIds", in: "body", type: "string[]", doc: "Tools made available to the assistant (capped at 12 per request by default)." },
      { name: "rowsPerCell", in: "body", type: "number", doc: "Conversations per (taxonomy × persona) cell. Default 1." },
      { name: "turns", in: "body", type: "number", doc: "User-turn count, 1..20. Default 1." },
      { name: "temperature", in: "body", type: "number", doc: "0..2, default 0.7." },
      { name: "maxTokens", in: "body", type: "number", doc: "16..64000, default 1024." },
      { name: "includeReasoning", in: "body", type: "boolean", doc: "When true, forces enable_thinking=true on every assistant turn." },
      { name: "formalityPolicy", in: "body", type: '"inherit" | "formal" | "semi-formal" | "colloquial" | "mixed"', doc: "Default inherit." },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/runs" \\
  -H "Authorization: Bearer $SGEN_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "agent-smoke",
    "templateId": "...",
    "languageProfileId": "...",
    "providerCredentialId": "...",
    "model": "qwen/qwen3.6-27b",
    "personaIds": ["..."],
    "taxonomyNodeIds": ["..."],
    "toolIds": ["..."],
    "turns": 3,
    "temperature": 0.7,
    "maxTokens": 8192,
    "includeReasoning": true
  }'`,
    },
    responses: [
      {
        code: 201,
        codeLabel: "Created",
        sample: `{
  "ok": true,
  "run": {
    "id": "cmqa...",
    "name": "agent-smoke",
    "status": "queued",
    "targetCount": 3
  }
}`,
      },
      {
        code: 400,
        codeLabel: "Bad request",
        doc: "Validation failed — e.g. no taxonomy nodes and no flows, totalCells > 1000.",
        sample: `{ "error": "Pick at least one taxonomy node, or one flow." }`,
      },
    ],
  },

  {
    id: "restart-run",
    group: "runs",
    method: "POST",
    path: "/api/v1/projects/:projectId/runs/:runId/restart",
    title: "Restart a run in place",
    description: (
      <>
        Wipes the run&apos;s existing conversations + resets every job to{" "}
        <code>pending</code>, then re-dispatches the worker. The run id and
        URL stay the same — useful when you want to verify a worker-side fix
        against the SAME frozen config (samplingParams, gridSpec, toolIds…)
        the original run had.
        <p className="mt-2 text-xs text-muted-foreground">
          Refuses while the run is still running/queued. Hit{" "}
          <code>/cancel</code> first.
        </p>
      </>
    ),
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/runs/$RUN/restart" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
    },
    responses: [
      {
        code: 200,
        codeLabel: "OK",
        sample: `{
  "ok": true,
  "run": { "id": "cmqalhf9l00e3wn448y0tdcii", "status": "queued" },
  "conversationsDeleted": 1,
  "jobsReset": 1
}`,
      },
      {
        code: 409,
        codeLabel: "Conflict",
        doc: "Run is still in flight — cancel before restart.",
        sample: `{ "error": "Run is still in flight — cancel it before restarting..." }`,
      },
    ],
  },
  {
    id: "replicate-run",
    group: "runs",
    method: "POST",
    path: "/api/v1/projects/:projectId/runs/:runId/replicate",
    title: "Replicate to a new run",
    description: (
      <>
        Clones the source run&apos;s frozen config into a <strong>new</strong>{" "}
        <code>GenerationRun</code> + materializes its <code>GenerationJob</code>{" "}
        grid + starts the worker. The source run is left untouched — its
        conversations stay around for comparison. Optional body field{" "}
        <code>name</code> overrides the default <em>&ldquo;{`<source> (copy)`}&rdquo;</em>{" "}
        label.
      </>
    ),
    parameters: [
      { name: "name", in: "body", type: "string", doc: "Custom name for the new run. Defaults to <source> (copy)." },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/runs/$RUN/replicate" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "name": "agent-rerun-2026-06-12" }'`,
    },
    responses: [
      {
        code: 201,
        codeLabel: "Created",
        sample: `{
  "ok": true,
  "run": { "id": "cmqa...", "name": "agent-rerun-2026-06-12", "status": "queued", "targetCount": 1 },
  "sourceRunId": "cmqalhf9l00e3wn448y0tdcii"
}`,
      },
      {
        code: 409,
        codeLabel: "Conflict",
        doc: "Original provider is no longer available in this project.",
        sample: `{ "error": "Original provider is no longer available — re-create the run via /runs..." }`,
      },
    ],
  },
  {
    id: "cancel-run",
    group: "runs",
    method: "POST",
    path: "/api/v1/projects/:projectId/runs/:runId/cancel",
    title: "Cancel a run",
    description: (
      <>
        Tell the Python worker to stop dispatching new jobs for this run and
        flip every <code>pending</code> job to <code>skipped</code>. Idempotent
        — cancelling an already-terminal run is a no-op. Pair with{" "}
        <code>/restart</code> to wipe + re-run.
      </>
    ),
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/runs/$RUN/cancel" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
    },
    responses: [
      {
        code: 200,
        codeLabel: "OK",
        sample: `{ "ok": true, "run": { "id": "cmqa...", "status": "cancelled" }, "jobsSkipped": 0 }`,
      },
    ],
  },

  {
    id: "list-run-jobs",
    group: "runs",
    method: "GET",
    path: "/api/v1/projects/:projectId/runs/:runId/jobs",
    title: "List a run's jobs",
    description: <>The per-cell <code>GenerationJob</code> detail behind a run&apos;s status counts — each with <code>status</code>, <code>attempts</code>, <code>lastError</code>, <code>conversationId</code>. Filter with <code>?status=failed</code>; paginate with <code>?limit</code>/<code>?offset</code>.</>,
    parameters: [
      { name: "status", in: "query", type: "string", doc: "Filter (pending|running|succeeded|failed|skipped|cancelled)." },
      { name: "limit", in: "query", type: "number", doc: "Default 200, max 1000." },
      { name: "offset", in: "query", type: "number", doc: "Pagination offset." },
    ],
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/runs/$RUN/jobs?status=failed" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "total": 224, "limit": 200, "offset": 0, "jobs": [{ "id": "...", "status": "failed", "attempts": 3, "lastError": "All connection attempts failed", "cellKey": "t:...|p:...|i:0", "conversationId": null }] }` }],
  },

  // ───── Conversations ─────
  {
    id: "list-conversations",
    group: "conversations",
    method: "GET",
    path: "/api/v1/projects/:projectId/conversations",
    title: "List conversations",
    description: <>Paginated summary rows. Filters: <code>?runId</code>, <code>?status</code>, <code>?topic</code> (taxonomyNodeId), <code>?lang</code>, <code>?personaId</code>, <code>?calibration=true</code>. Use the detail endpoint for full messages.</>,
    parameters: [
      { name: "runId", in: "query", type: "string", doc: "Filter to one run." },
      { name: "status", in: "query", type: "string", doc: "generated|accepted|rejected|flagged|annotated." },
      { name: "limit", in: "query", type: "number", doc: "Default 50, max 500." },
      { name: "offset", in: "query", type: "number", doc: "Pagination offset." },
    ],
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/conversations?status=accepted&limit=20" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "total": 142, "limit": 20, "offset": 0, "conversations": [{ "id": "...", "runId": "...", "status": "accepted", "primaryLanguage": "ms", "turnCount": 3, "isCalibration": false }] }` }],
  },
  {
    id: "get-conversation",
    group: "conversations",
    method: "GET",
    path: "/api/v1/projects/:projectId/conversations/:conversationId",
    title: "Conversation detail",
    description: (
      <>
        Full thread including <code>reasoningContent</code> and{" "}
        <code>toolCalls</code> per row, validations, and the frozen{" "}
        <code>settingsSnapshot</code>. This is the canonical endpoint for an
        agent debugging a synthetic generation.
      </>
    ),
    request: {
      sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/conversations/$CONV" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
    },
    responses: [
      {
        code: 200,
        codeLabel: "OK",
        sample: `{
  "conversation": {
    "id": "c00mq9jpty502ib6i1mstadec",
    "runId": "cmq9h8hx1007ewn44pzagc9eb",
    "status": "accepted",
    "settingsSnapshot": { /* frozen at persist */ },
    "messages": [
      {
        "ordinal": 2,
        "role": "assistant",
        "content": "",
        "reasoningContent": "<chain-of-thought before tool call>",
        "toolCalls": [{ "id": "call_...", "type": "function", "function": { "name": "initiate_reconciliation_run", "arguments": "{...}" } }],
        "toolCallId": null,
        "tokenCount": 2065
      },
      {
        "ordinal": 3,
        "role": "tool",
        "content": "{ \\"reconciliation_run_id\\": \\"REC-MY-PRK-...\\" }",
        "reasoningContent": "<mock backend's chain-of-thought>",
        "toolCallId": "call_..."
      }
    ],
    "validations": []
  }
}`,
      },
    ],
  },

  {
    id: "annotate-conversation",
    group: "conversations",
    method: "PATCH",
    path: "/api/v1/projects/:projectId/conversations/:conversationId",
    title: "Curate a conversation",
    description: <>Set review <code>status</code> (accept/reject/flag) and/or toggle calibration with expected per-axis scores. Requires <code>conversations.annotate</code>.</>,
    parameters: [
      { name: "status", in: "body", type: '"generated" | "accepted" | "rejected" | "flagged" | "annotated"', doc: "New review status." },
      { name: "isCalibration", in: "body", type: "boolean", doc: "Mark/unmark as a judge-drift calibration item." },
      { name: "expected", in: "body", type: "Record<string, number>", doc: "Expected per-rubric-axis scores; null clears." },
    ],
    request: {
      sample: `curl -s -X PATCH "$SGEN/api/v1/projects/$PROJECT/conversations/$CONV" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "status": "accepted" }'`,
    },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "ok": true, "conversation": { "id": "...", "status": "accepted", "isCalibration": false } }` }],
  },
  {
    id: "delete-conversation",
    group: "conversations",
    method: "DELETE",
    path: "/api/v1/projects/:projectId/conversations/:conversationId",
    title: "Delete a conversation",
    description: <>Requires <code>conversations.annotate</code>. 409 if the conversation is pinned into a frozen dataset version — delete that version first.</>,
    request: { sample: `curl -s -X DELETE "$SGEN/api/v1/projects/$PROJECT/conversations/$CONV" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "ok": true, "id": "..." }` }],
  },
  {
    id: "export-conversations",
    group: "conversations",
    method: "GET",
    path: "/api/v1/projects/:projectId/conversations/export",
    title: "Export conversations",
    description: <>Ad-hoc download of (filtered) conversations with full messages. Same filters as the list endpoint. <code>?format=jsonl</code> (default) or <code>json</code>. For an immutable snapshot, freeze a dataset instead.</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/conversations/export?status=accepted&format=jsonl" -H "Authorization: Bearer $SGEN_TOKEN" -o convos.jsonl` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{"id":"...","status":"accepted","messages":[...]}\\n{"id":"...","messages":[...]}` }],
  },

  // ───── Providers ─────
  {
    id: "list-providers",
    group: "providers",
    method: "GET",
    path: "/api/v1/projects/:projectId/providers",
    title: "List providers",
    description: <>Provider credentials in this project. The encrypted API key is never returned — only its <code>keyFingerprint</code> (last 4 + hash).</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/providers" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [
      { code: 200, codeLabel: "OK", sample: `{ "providers": [{ "id": "...", "name": "...", "kind": "vllm", "baseUrl": "https://...", "defaultModel": "qwen/...", "keyFingerprint": "...", "reasoningEffort": null }] }` },
    ],
  },
  {
    id: "create-provider",
    group: "providers",
    method: "POST",
    path: "/api/v1/projects/:projectId/providers",
    title: "Create a provider",
    description: <>The plaintext <code>apiKey</code> is AES-256-GCM encrypted server-side. <code>kind</code> picks request shape — vLLM vs OpenAI vs Mistral vs OpenRouter, etc.</>,
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "Unique within the project." },
      { name: "kind", in: "body", type: '"openai" | "vllm" | "together" | "openrouter" | "sglang" | "anthropic-proxy" | "custom"', required: true, doc: "Request format." },
      { name: "baseUrl", in: "body", type: "string", required: true, doc: "Full chat-completions base, e.g. https://api.openai.com/v1." },
      { name: "apiKey", in: "body", type: "string", required: true, doc: "Plaintext key — encrypted before storage." },
      { name: "defaultModel", in: "body", type: "string", doc: "Pre-fills the run wizard's model field." },
      { name: "reasoningEffort", in: "body", type: '"low" | "medium" | "high"', doc: "OpenAI o-series reasoning effort." },
      { name: "chatTemplateKwargs", in: "body", type: "object", doc: "Sent as chat_template_kwargs on every request (e.g. {enable_thinking: false})." },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/providers" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{
    "name": "serverless-qwen",
    "kind": "vllm",
    "baseUrl": "https://serverlessgpu.aies.scicom.dev/proxy/for-agentic/v1",
    "apiKey": "...",
    "defaultModel": "qwen/qwen3.6-27b"
  }'`,
    },
    responses: [
      { code: 201, codeLabel: "Created", sample: `{ "ok": true, "provider": { "id": "...", "name": "serverless-qwen", "keyFingerprint": "..." } }` },
    ],
  },

  // ───── Personas ─────
  {
    id: "list-personas",
    group: "personas",
    method: "GET",
    path: "/api/v1/projects/:projectId/personas",
    title: "List personas",
    description: <>Project personas with their demographic + register fields.</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/personas" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "personas": [{ "id": "...", "name": "Pelanggan Kampung", "formality": "colloquial", "region": "kelantan", "urbanity": "kampung" }] }` }],
  },
  {
    id: "create-persona",
    group: "personas",
    method: "POST",
    path: "/api/v1/projects/:projectId/personas",
    title: "Create a persona",
    description: <>Required: <code>name</code>. Everything else is optional and shapes the persona prompt sent to the user-simulator.</>,
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "Display name." },
      { name: "ethnicity", in: "body", type: "string", doc: "e.g. malay, chinese, indian." },
      { name: "region", in: "body", type: "string", doc: "Malaysian state or city." },
      { name: "urbanity", in: "body", type: '"urban" | "suburban" | "kampung"', doc: "Demographic axis." },
      { name: "ageRange", in: "body", type: "string", doc: "e.g. 18-24, 25-34." },
      { name: "formality", in: "body", type: '"baku" | "colloquial" | "manglish" | "mixed"', doc: "Default register." },
      { name: "dialectTags", in: "body", type: "string[]", doc: "Free-form tags (e.g. kelantan-baku, professional-bilingual)." },
      { name: "languageProfileId", in: "body", type: "string", doc: "Pins the persona to a specific LanguageProfile." },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/personas" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{
    "name": "Indian-Malaysian Corporate Client",
    "ethnicity": "indian",
    "region": "perak",
    "urbanity": "urban",
    "ageRange": "35-49",
    "formality": "baku",
    "dialectTags": ["professional-bilingual", "indian-malay"]
  }'`,
    },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "persona": { "id": "...", "name": "Indian-Malaysian Corporate Client" } }` }],
  },

  // ───── Templates ─────
  {
    id: "list-templates",
    group: "templates",
    method: "GET",
    path: "/api/v1/projects/:projectId/templates",
    title: "List templates",
    description: <>All PromptTemplate rows; filter by <code>kind</code> client-side.</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/templates" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "templates": [{ "id": "...", "name": "Reconciliation Driver", "kind": "user-seed", "description": "..." }] }` }],
  },
  {
    id: "create-template",
    group: "templates",
    method: "POST",
    path: "/api/v1/projects/:projectId/templates",
    title: "Create a template",
    description: <>Body is interpolated with run-time variables (<code>{`{{persona.name}}`}</code>, <code>{`{{taxonomy.related}}`}</code>, etc).</>,
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "Display name." },
      { name: "kind", in: "body", type: '"system" | "user-seed" | "judge" | "conversation-driver"', doc: "Default user-seed." },
      { name: "body", in: "body", type: "string", required: true, doc: "Template text, up to 50000 chars." },
      { name: "description", in: "body", type: "string", doc: "Optional, up to 2000 chars." },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/templates" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{
    "name": "Reconciliation Driver",
    "kind": "user-seed",
    "body": "You are an enterprise reconciliation operations user..."
  }'`,
    },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "template": { "id": "...", "name": "Reconciliation Driver", "kind": "user-seed" } }` }],
  },

  // ───── Language profiles ─────
  {
    id: "list-languages",
    group: "languages",
    method: "GET",
    path: "/api/v1/projects/:projectId/languages",
    title: "List language profiles",
    description: <>Project profiles plus any presets the worker bootstrapped at project create.</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/languages" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "languageProfiles": [{ "id": "...", "name": "Malaysia – Casual (Manglish OK)", "primary": "ms", "register": "colloquial", "allowParticles": true }] }` }],
  },
  {
    id: "create-language",
    group: "languages",
    method: "POST",
    path: "/api/v1/projects/:projectId/languages",
    title: "Create a language profile",
    description: <>Define register, code-switch policy, and banned-token policy for one locale.</>,
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "Display name." },
      { name: "primary", in: "body", type: '"ms" | "en" | "zh" | "ta"', required: true, doc: "Primary language." },
      { name: "register", in: "body", type: '"formal" | "semi-formal" | "colloquial" | "mixed"', doc: "Default formal." },
      { name: "allowParticles", in: "body", type: "boolean", doc: "Whether lah/lor/meh particles are permitted." },
      { name: "codeSwitchPolicy", in: "body", type: '"none" | "inter-sentential" | "intra-sentential" | "rojak"', doc: "Default none." },
      { name: "codeSwitchRate", in: "body", type: "number", doc: "0..1 fraction of mixed-language sentences." },
      { name: "script", in: "body", type: '"latin" | "jawi" | "hans" | "hant" | "tamil"', doc: "Default latin." },
      { name: "bannedTokens", in: "body", type: "string[]", doc: "Tokens validated and rejected post-generation." },
      { name: "bannedPatterns", in: "body", type: "string[]", doc: "Regex patterns rejected post-generation." },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/languages" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{
    "name": "MY · Formal Baku",
    "primary": "ms",
    "register": "formal",
    "allowParticles": false,
    "codeSwitchPolicy": "none"
  }'`,
    },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "languageProfile": { "id": "...", "name": "MY · Formal Baku" } }` }],
  },

  // ───── Tools ─────
  {
    id: "list-tools",
    group: "tools",
    method: "GET",
    path: "/api/v1/projects/:projectId/tools",
    title: "List tools",
    description: <>Every ToolDef across every catalog in the project.</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/tools" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "tools": [{ "id": "...", "catalogId": "...", "name": "initiate_reconciliation_run", "description": "...", "parameters": { /* JSON Schema */ } }] }` }],
  },
  {
    id: "create-tool",
    group: "tools",
    method: "POST",
    path: "/api/v1/projects/:projectId/tools",
    title: "Create a tool",
    description: (
      <>
        Insert a single OpenAI-shape tool. <code>catalogId</code> is optional —
        when omitted we use (or create) the project&apos;s default catalog. To
        bulk-import 50+ tools, paste a JSON array on the Tools page in the UI.
      </>
    ),
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "snake_case identifier (regex: ^[a-zA-Z_][a-zA-Z0-9_]*$)." },
      { name: "description", in: "body", type: "string", required: true, doc: "What the tool does." },
      { name: "parameters", in: "body", type: "object (JSON Schema)", required: true, doc: "OpenAI-style JSON Schema." },
      { name: "catalogId", in: "body", type: "string", doc: "Defaults to the first project catalog (auto-created)." },
      { name: "localePresets", in: "body", type: "string[]", doc: 'e.g. ["my-banking", "lhdn"].' },
      { name: "mockSeed", in: "body", type: "object", doc: "Static mock response. Wins over mockResponseSchema." },
      { name: "mockResponseSchema", in: "body", type: "object", doc: "JSON Schema the mock LLM fills." },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/tools" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{
    "name": "get_reconciliation_run_status",
    "description": "Retrieve status + metrics of a reconciliation run.",
    "parameters": {
      "type": "object",
      "required": ["reconciliation_run_id"],
      "properties": {
        "reconciliation_run_id": { "type": "string" },
        "include_metrics": { "type": "boolean", "default": true }
      }
    }
  }'`,
    },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "tool": { "id": "...", "name": "get_reconciliation_run_status", "catalogId": "..." } }` }],
  },

  // ───── Flows ─────
  {
    id: "list-flows",
    group: "flows",
    method: "GET",
    path: "/api/v1/projects/:projectId/flows",
    title: "List flows",
    description: <>Flow DAGs in this project. <code>isPublished</code> gates them for use in runs.</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/flows" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "flows": [{ "id": "...", "name": "Reconciliation Lifecycle", "version": 1, "isPublished": true }] }` }],
  },
  {
    id: "create-flow",
    group: "flows",
    method: "POST",
    path: "/api/v1/projects/:projectId/flows",
    title: "Create a flow",
    description: (
      <>
        Creates an empty flow. Use the visual editor at{" "}
        <code>/projects/:projectId/flows/:flowId</code> to populate nodes +
        edges, then publish it. A future PATCH endpoint will let agents
        author flows by id.
      </>
    ),
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "Display name." },
      { name: "description", in: "body", type: "string", doc: "Optional, up to 500 chars." },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/flows" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "name": "Reconciliation Lifecycle" }'`,
    },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "flow": { "id": "...", "name": "Reconciliation Lifecycle", "version": 1, "isPublished": false } }` }],
  },

  // ───── Rubrics ─────
  {
    id: "list-rubrics",
    group: "rubrics",
    method: "GET",
    path: "/api/v1/projects/:projectId/rubrics",
    title: "List rubrics",
    description: <>Multi-axis scoring rubrics this project's benchmarks can plug in.</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/rubrics" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "rubrics": [{ "id": "...", "name": "Reconciliation Quality", "axes": [{ "key": "correctness", "scale": 5, "weight": 2 }] }] }` }],
  },
  {
    id: "create-rubric",
    group: "rubrics",
    method: "POST",
    path: "/api/v1/projects/:projectId/rubrics",
    title: "Create a rubric",
    description: <>1..10 axes; each axis has a snake_case <code>key</code>, a Likert <code>scale</code> 2..10, and a <code>weight</code> 0..10.</>,
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "Display name." },
      { name: "description", in: "body", type: "string", doc: "Optional, up to 1000 chars." },
      { name: "axes", in: "body", type: "Array<{key, name, description, scale, weight}>", required: true, doc: "1..10 axes." },
    ],
    request: {
      sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/rubrics" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{
    "name": "Reconciliation Quality",
    "axes": [
      { "key": "correctness", "name": "Correctness", "description": "Did the assistant answer the user accurately?", "scale": 5, "weight": 2 },
      { "key": "naturalness", "name": "Naturalness", "description": "Reads like a real Malaysian customer-support agent.", "scale": 5, "weight": 1 }
    ]
  }'`,
    },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "rubric": { "id": "...", "name": "Reconciliation Quality" } }` }],
  },

  // ───── Resource update / delete (PATCH + DELETE on existing resources) ─────
  {
    id: "update-persona",
    group: "personas",
    method: "PATCH",
    path: "/api/v1/projects/:projectId/personas/:personaId",
    title: "Update / delete a persona",
    description: <>Partial update — only the fields you send change (null clears a nullable field). <code>DELETE</code> the same path to remove it (409 if referenced).</>,
    request: { sample: `curl -s -X PATCH "$SGEN/api/v1/projects/$PROJECT/personas/$ID" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "region": "selangor", "formality": "manglish" }'` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "ok": true, "persona": { "id": "...", "name": "..." } }` }],
  },
  {
    id: "update-template",
    group: "templates",
    method: "PATCH",
    path: "/api/v1/projects/:projectId/templates/:templateId",
    title: "Update / delete a template",
    description: <>Partial update; editing <code>body</code> bumps the version (historical runs keep their snapshot). <code>DELETE</code> refuses if a run references it.</>,
    request: { sample: `curl -s -X PATCH "$SGEN/api/v1/projects/$PROJECT/templates/$ID" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "body": "You are an updated assistant…" }'` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "ok": true, "template": { "id": "...", "version": 2 } }` }],
  },
  {
    id: "update-language",
    group: "languages",
    method: "PATCH",
    path: "/api/v1/projects/:projectId/languages/:languageId",
    title: "Update / delete a language profile",
    description: <>Partial update of any profile field. <code>DELETE</code> refuses if a persona or run references the profile.</>,
    request: { sample: `curl -s -X PATCH "$SGEN/api/v1/projects/$PROJECT/languages/$ID" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "allowParticles": true, "register": "colloquial" }'` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "ok": true, "languageProfile": { "id": "...", "name": "..." } }` }],
  },
  {
    id: "update-tool",
    group: "tools",
    method: "PATCH",
    path: "/api/v1/projects/:projectId/tools/:toolId",
    title: "Update / delete a tool",
    description: <>Partial update (any change bumps the version). <code>DELETE</code> the same path to remove it.</>,
    request: { sample: `curl -s -X PATCH "$SGEN/api/v1/projects/$PROJECT/tools/$ID" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "description": "Updated description" }'` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "ok": true, "tool": { "id": "...", "version": 2 } }` }],
  },
  {
    id: "bulk-tools",
    group: "tools",
    method: "POST",
    path: "/api/v1/projects/:projectId/tools/bulk",
    title: "Bulk-import tools",
    description: <>Import up to 500 OpenAI-shape tools in one call. <code>{`mode: "skip"`}</code> leaves same-name tools alone; <code>{`"overwrite"`}</code> replaces them. Per-item outcomes are returned.</>,
    parameters: [
      { name: "tools", in: "body", type: "Array<{name, description, parameters}>", required: true, doc: "1..500 tool defs." },
      { name: "mode", in: "body", type: '"skip" | "overwrite"', doc: "Default skip." },
      { name: "catalogId", in: "body", type: "string", doc: "Defaults to the project's first catalog (auto-created)." },
    ],
    request: { sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/tools/bulk" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "mode": "overwrite", "tools": [{ "name": "lookup_account", "description": "…", "parameters": { "type": "object", "properties": {} } }] }'` },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "total": 1, "created": 1, "updated": 0, "skipped": 0, "failed": 0, "results": [{ "ok": true, "name": "lookup_account", "id": "...", "action": "created" }] }` }],
  },
  {
    id: "update-rubric",
    group: "rubrics",
    method: "PATCH",
    path: "/api/v1/projects/:projectId/rubrics/:rubricId",
    title: "Update / delete a rubric",
    description: <>Partial update (axis keys must stay unique). Preset rubrics are read-only (409). <code>DELETE</code> the same path to remove a non-preset rubric.</>,
    request: { sample: `curl -s -X PATCH "$SGEN/api/v1/projects/$PROJECT/rubrics/$ID" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "description": "v2 scoring guidance" }'` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "ok": true, "rubric": { "id": "...", "name": "..." } }` }],
  },
  {
    id: "update-flow",
    group: "flows",
    method: "PATCH",
    path: "/api/v1/projects/:projectId/flows/:flowId",
    title: "Author / publish / delete a flow",
    description: <>Send <code>nodes</code>+<code>edges</code> together to replace the graph (validated: edges reference known nodes, exactly one Start), and/or <code>isPublished</code> to (un)publish. <code>GET</code> returns the full graph; <code>DELETE</code> removes it.</>,
    parameters: [
      { name: "nodes", in: "body", type: "FlowNode[]", doc: "Full node list (with edges). start|intent|action|condition|end." },
      { name: "edges", in: "body", type: "FlowEdge[]", doc: "Full edge list (with nodes)." },
      { name: "isPublished", in: "body", type: "boolean", doc: "Gate the flow for use in runs." },
    ],
    request: { sample: `curl -s -X PATCH "$SGEN/api/v1/projects/$PROJECT/flows/$ID" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "isPublished": true }'` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "ok": true, "flow": { "id": "...", "isPublished": true, "version": 1 } }` }],
  },

  // ───── Benchmarks ─────
  {
    id: "list-benchmarks",
    group: "benchmarks",
    method: "GET",
    path: "/api/v1/projects/:projectId/benchmarks",
    title: "List benchmarks",
    description: <>All benchmarks with item + run counts. <code>GET …/benchmarks/:id</code> returns detail + recent runs; <code>DELETE</code> removes one (409 while a run is in flight).</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/benchmarks" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "benchmarks": [{ "id": "...", "name": "...", "kind": "project-chat-replay", "mode": "single-turn", "itemCount": 50, "runCount": 2 }] }` }],
  },
  {
    id: "create-benchmark",
    group: "benchmarks",
    method: "POST",
    path: "/api/v1/projects/:projectId/benchmarks",
    title: "Create a benchmark",
    description: <>Freezes the conversations matching <code>filter</code> (default status=accepted) into a chat-replay benchmark. The frozen set is fixed even if the filter would later match different rows.</>,
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "2-120 chars." },
      { name: "mode", in: "body", type: '"single-turn" | "multi-turn"', required: true, doc: "Replay mode." },
      { name: "filter", in: "body", type: "{ runIds?, personaIds?, taxonomyNodeIds?, statuses?, limit? }", doc: "Which conversations to freeze. Default { statuses: [accepted], limit: 200 }." },
      { name: "defaultRubricId", in: "body", type: "string", doc: "Default rubric for runs." },
    ],
    request: { sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/benchmarks" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "name": "MY support replay", "mode": "single-turn", "filter": { "statuses": ["accepted"], "limit": 100 }, "defaultRubricId": "$RUBRIC" }'` },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "benchmark": { "id": "...", "name": "MY support replay", "itemCount": 100 } }` }],
  },
  {
    id: "start-benchmark-run",
    group: "benchmarks",
    method: "POST",
    path: "/api/v1/projects/:projectId/benchmarks/:benchmarkId/runs",
    title: "Start a benchmark run",
    description: <>Score a candidate model against the frozen set. Chat-replay requires an <code>ensembleGroupId</code> (or the benchmark default) and a rubric. Dispatches to the worker; poll the run detail until terminal. <code>GET …/runs</code> lists runs.</>,
    parameters: [
      { name: "providerCredentialId", in: "body", type: "string", required: true, doc: "Candidate provider." },
      { name: "model", in: "body", type: "string", required: true, doc: "Candidate model." },
      { name: "ensembleGroupId", in: "body", type: "string", doc: "Judge group (required for chat-replay unless the benchmark has a default)." },
      { name: "rubricId", in: "body", type: "string", doc: "Overrides the benchmark default rubric." },
      { name: "mode", in: "body", type: '"single-turn" | "multi-turn"', doc: "Overrides the benchmark mode." },
      { name: "samplingParams", in: "body", type: "object", doc: "Candidate + judge sampling overrides (temperature, max_tokens, judge_strategy, concurrency…)." },
    ],
    request: { sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/benchmarks/$BENCH/runs" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "providerCredentialId": "$PROVIDER", "model": "qwen/qwen3.6-27b", "ensembleGroupId": "$GROUP" }'` },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "run": { "id": "...", "status": "queued", "mode": "single-turn" } }` }],
  },
  {
    id: "get-benchmark-run",
    group: "benchmarks",
    method: "GET",
    path: "/api/v1/projects/:projectId/benchmarks/:benchmarkId/runs/:runId",
    title: "Benchmark run detail",
    description: <>Status, live counters, aggregate <code>metrics</code>, token/cost totals, and a count of results by judge verdict. <code>POST …/cancel</code> stops it; <code>POST …/restart</code> re-runs (<code>{`{ mode: "fresh" | "resume" }`}</code>).</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/benchmarks/$BENCH/runs/$RUN" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "run": { "id": "...", "status": "completed", "model": "qwen/qwen3.6-27b", "completedTurns": 100, "totalTurns": 100, "tokensIn": 482910, "metrics": { "overall": { "axes": { "language_fidelity": 4.2 } } } }, "verdictCounts": { "pass": 64, "warn": 33, "fail": 3 } }` }],
  },

  // ───── Ensemble judge groups ─────
  {
    id: "list-ensemble-groups",
    group: "ensemble-groups",
    method: "GET",
    path: "/api/v1/projects/:projectId/ensemble-groups",
    title: "List / create / delete judge groups",
    description: <>List groups, <code>POST</code> to create one (every judge&apos;s provider must be in the project), <code>DELETE …/:groupId</code> to remove. Requires <code>benchmarks.write</code> to mutate.</>,
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "POST: unique group name." },
      { name: "judges", in: "body", type: "Array<{providerCredentialId, model}>", required: true, doc: "1..8 judges." },
    ],
    request: { sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/ensemble-groups" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "name": "3-judge panel", "judges": [{ "providerCredentialId": "$P", "model": "qwen/qwen3.6-27b" }] }'` },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "ensembleGroup": { "id": "...", "name": "3-judge panel", "judgeCount": 1 } }` }],
  },

  // ───── Datasets ─────
  {
    id: "list-datasets",
    group: "datasets",
    method: "GET",
    path: "/api/v1/projects/:projectId/datasets",
    title: "List datasets",
    description: <>Datasets with version counts + pinned current version. <code>GET …/:datasetId</code> returns all versions with freeze-time stats.</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/datasets" -H "Authorization: Bearer $SGEN_TOKEN"` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{ "datasets": [{ "id": "...", "name": "MY support v1", "currentVersion": "0.2.0", "versionCount": 2 }] }` }],
  },
  {
    id: "freeze-dataset",
    group: "datasets",
    method: "POST",
    path: "/api/v1/projects/:projectId/datasets",
    title: "Freeze a dataset version",
    description: <>Snapshots conversations (by <code>filter</code> or explicit <code>conversationIds</code>) into an immutable version. Creates the parent dataset on first freeze; <code>version</code> auto-bumps the patch if omitted. Requires <code>datasets.freeze</code>.</>,
    parameters: [
      { name: "name", in: "body", type: "string", required: true, doc: "Dataset name (find-or-create)." },
      { name: "filter", in: "body", type: "{ runIds?, personaIds?, taxonomyNodeIds?, statuses?, limit? }", doc: "Which conversations to freeze (default status=accepted)." },
      { name: "conversationIds", in: "body", type: "string[]", doc: "Explicit ids instead of a filter." },
      { name: "version", in: "body", type: "string (semver)", doc: "e.g. 0.2.0. Omit to auto-bump." },
      { name: "changelog", in: "body", type: "string", doc: "Optional notes." },
    ],
    request: { sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/datasets" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "name": "MY support", "filter": { "statuses": ["accepted"], "limit": 500 } }'` },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "dataset": { "id": "...", "name": "MY support" }, "version": { "id": "...", "version": "0.1.0", "itemCount": 142, "stats": { "total": 142, "byLanguage": { "ms": 90, "en": 52 } } } }` }],
  },
  {
    id: "export-dataset",
    group: "datasets",
    method: "GET",
    path: "/api/v1/projects/:projectId/datasets/:datasetId/versions/:versionId/export",
    title: "Download a dataset version",
    description: <>Streams the frozen conversation set with full messages. <code>?format=jsonl</code> (default) or <code>json</code>. Requires <code>datasets.export</code>.</>,
    request: { sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/datasets/$DS/versions/$VER/export?format=jsonl" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -o dataset.jsonl` },
    responses: [{ code: 200, codeLabel: "OK", sample: `{"id":"...","status":"accepted","persona":{...},"topic":{...},"messages":[...]}` }],
  },

  // ───── Knowledge base ─────
  {
    id: "list-knowledge",
    group: "knowledge",
    method: "GET",
    path: "/api/v1/projects/:projectId/knowledge",
    title: "List / create knowledge entries",
    description: <>List entries (add <code>?full=true</code> for content). <code>POST</code> one entry, or many at once by passing an <code>entries</code> array. <code>PATCH</code>/<code>DELETE …/:entryId</code> to edit/remove. Requires <code>knowledge.write</code> to mutate.</>,
    parameters: [
      { name: "title", in: "body", type: "string", required: true, doc: "Entry title (single create)." },
      { name: "content", in: "body", type: "string", required: true, doc: "Document text (single create)." },
      { name: "tags", in: "body", type: "string[]", doc: "Free-form tags." },
      { name: "taxonomyNodeIds", in: "body", type: "string[]", doc: "Topic links." },
      { name: "entries", in: "body", type: "Array<{title, content, sourceUrl?}>", doc: "Bulk create (1..100) instead of a single entry." },
    ],
    request: { sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/knowledge" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "title": "Refund policy", "content": "Refunds are processed within 14 days…", "tags": ["billing"] }'` },
    responses: [{ code: 201, codeLabel: "Created", sample: `{ "ok": true, "entry": { "id": "...", "title": "Refund policy" } }` }],
  },
];

const ERROR_TABLE: Array<{ code: string; meaning: string }> = [
  { code: "401 Unauthorized", meaning: "Missing / revoked / malformed bearer token. Mint a fresh token at /api-keys." },
  { code: "403 Forbidden", meaning: "Token is valid but you have no membership in the requested project, OR your project role lacks the required action (e.g. a viewer trying to call runs.execute)." },
  { code: "404 Not Found", meaning: "Resource doesn't exist in this project. Cross-project lookups also 404 to avoid leaking existence." },
  { code: "400 Bad Request", meaning: "Schema validation failed — the `error` field carries the first failed field." },
  { code: "409 Conflict", meaning: "Name already exists (e.g. provider name unique-per-project) or slug collision on project create." },
];

interface Recipe {
  id: string;
  title: string;
  blurb: React.ReactNode;
  steps: Array<{ label: string; sample: string }>;
}

const RECIPES: Recipe[] = [
  {
    id: "recipe-debug-run",
    title: "Debug a synthetic run end-to-end",
    blurb: (
      <>
        Walk the most recent run&apos;s conversations and print every assistant
        turn&apos;s reasoning + tool calls. Useful for an agent verifying that
        a generation produced the expected schema.
      </>
    ),
    steps: [
      {
        label: "1. Find the project",
        sample: `curl -s "$SGEN/api/v1/projects" -H "Authorization: Bearer $SGEN_TOKEN"`,
      },
      {
        label: "2. List recent runs",
        sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/runs?limit=5" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
      },
      {
        label: "3. Fetch one run's frozen config + conversations head",
        sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/runs/$RUN" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
      },
      {
        label: "4. Inspect a conversation's full message thread",
        sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/conversations/$CONV" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
      },
    ],
  },
  {
    id: "recipe-regenerate-run",
    title: "Regenerate all conversations on an existing run",
    blurb: (
      <>
        Two ways depending on whether you want to <strong>preserve the source</strong>:
        clone into a new run (source stays for comparison) or restart in place
        (source URL is reused, conversations wiped + jobs reset to pending).
      </>
    ),
    steps: [
      {
        label: "Option A · Clone into a new run (recommended)",
        sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/runs/$RUN/replicate" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{ "name": "agent-rerun" }'`,
      },
      {
        label: "Option B · Restart in place (cancel first if still running)",
        sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/runs/$RUN/cancel" \\
  -H "Authorization: Bearer $SGEN_TOKEN"

curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/runs/$RUN/restart" \\
  -H "Authorization: Bearer $SGEN_TOKEN"`,
      },
      {
        label: "Poll until done",
        sample: `while [ "$(curl -s "$SGEN/api/v1/projects/$PROJECT/runs/$RUN" \\
  -H "Authorization: Bearer $SGEN_TOKEN" | jq -r '.run.status')" = "queued" ] \\
   || [ "$(curl -s "$SGEN/api/v1/projects/$PROJECT/runs/$RUN" \\
  -H "Authorization: Bearer $SGEN_TOKEN" | jq -r '.run.status')" = "running" ]; do
  sleep 5
done`,
      },
    ],
  },
  {
    id: "recipe-trigger-run",
    title: "Trigger a new run from a script",
    blurb: (
      <>
        Set up the wiring once via API (provider + persona + template + tools),
        then launch a run programmatically. Useful for regression sweeps.
      </>
    ),
    steps: [
      {
        label: "1. Create a provider",
        sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/providers" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{
    "name": "serverless-qwen",
    "kind": "vllm",
    "baseUrl": "https://serverlessgpu.aies.scicom.dev/proxy/for-agentic/v1",
    "apiKey": "...",
    "defaultModel": "qwen/qwen3.6-27b"
  }'`,
      },
      {
        label: "2. Pick (or create) a persona + template + language profile",
        sample: `curl -s "$SGEN/api/v1/projects/$PROJECT/personas" -H "Authorization: Bearer $SGEN_TOKEN"
curl -s "$SGEN/api/v1/projects/$PROJECT/templates" -H "Authorization: Bearer $SGEN_TOKEN"
curl -s "$SGEN/api/v1/projects/$PROJECT/languages" -H "Authorization: Bearer $SGEN_TOKEN"`,
      },
      {
        label: "3. POST a new run — same fields as the /runs/new wizard",
        sample: `curl -s -X POST "$SGEN/api/v1/projects/$PROJECT/runs" \\
  -H "Authorization: Bearer $SGEN_TOKEN" -H "Content-Type: application/json" \\
  -d '{
    "name": "agent-smoke",
    "templateId": "$TEMPLATE",
    "languageProfileId": "$LP",
    "providerCredentialId": "$PROVIDER",
    "model": "qwen/qwen3.6-27b",
    "personaIds": ["$PERSONA"],
    "taxonomyNodeIds": ["$NODE"],
    "toolIds": ["$TOOL_A","$TOOL_B"],
    "turns": 3, "temperature": 0.7, "maxTokens": 8192,
    "includeReasoning": true
  }'`,
      },
      {
        label: "4. Poll the run until done",
        sample: `while [ "$(curl -s "$SGEN/api/v1/projects/$PROJECT/runs/$RUN" \\
  -H "Authorization: Bearer $SGEN_TOKEN" | jq -r '.run.status')" = "running" ]; do
  sleep 5
done`,
      },
    ],
  },
];

const SIDEBAR_MIN_PX = 200;
const SIDEBAR_MAX_PX = 480;
const SIDEBAR_DEFAULT_PX = 240;
const SIDEBAR_LS_KEY = "synthgen.apidocs.sidebarWidth";

export function ApiDocs() {
  const [base, setBase] = useState("http://localhost:3001");
  useEffect(() => {
    if (typeof window !== "undefined") setBase(window.location.origin);
  }, []);

  const [query, setQuery] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_DEFAULT_PX);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_LS_KEY);
    if (!saved) return;
    const n = parseInt(saved, 10);
    if (Number.isFinite(n) && n >= SIDEBAR_MIN_PX && n <= SIDEBAR_MAX_PX) {
      setSidebarWidth(n);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_LS_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  const onDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (mv: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = mv.clientX - dragRef.current.startX;
      setSidebarWidth(
        Math.max(
          SIDEBAR_MIN_PX,
          Math.min(SIDEBAR_MAX_PX, dragRef.current.startWidth + delta),
        ),
      );
    };
    const up = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    e.preventDefault();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ENDPOINTS;
    return ENDPOINTS.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const out: Array<{ group: Group; items: Endpoint[] }> = [];
    for (const g of GROUPS) {
      const items = filtered.filter((e) => e.group === g.id);
      if (items.length > 0) out.push({ group: g, items });
    }
    return out;
  }, [filtered]);

  return (
    <div
      className="grid grid-cols-1 lg:grid-cols-[var(--sgen-docs-w)_1px_minmax(0,1fr)]"
      style={{ "--sgen-docs-w": `${sidebarWidth}px` } as React.CSSProperties}
    >
      {/* Endpoint nav */}
      <aside className="hidden lg:block">
        <div className="sticky top-0 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-3 py-4">
          <div className="relative flex h-9 items-center">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search endpoints…"
              className="h-9 pl-8 text-xs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <nav className="mt-3 space-y-2.5 text-sm">
            <a
              href="#auth"
              className="block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/80 hover:text-foreground"
            >
              Authentication
            </a>
            {!query && (
              <a
                href="#recipes"
                className="block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/80 hover:text-foreground"
              >
                Recipes
              </a>
            )}
            {grouped.map(({ group, items }) => (
              <div key={group.id} className="space-y-px">
                <a
                  href={`#${group.id}`}
                  className="block px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/80"
                >
                  {group.title}
                </a>
                <ul>
                  {items.map((e) => (
                    <li key={e.id}>
                      <a
                        href={`#${e.id}`}
                        className="flex items-center gap-1.5 rounded px-2 py-0.5 hover:bg-muted"
                      >
                        <MethodBadge method={e.method} size="xs" />
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {e.path}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <a
              href="#errors"
              className="block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/80 hover:text-foreground"
            >
              Errors
            </a>
          </nav>
        </div>
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize endpoint list"
        onMouseDown={onDragStart}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_PX)}
        className="relative hidden cursor-col-resize select-none bg-border transition-colors hover:bg-primary/40 lg:block"
        title="Drag to resize · double-click to reset"
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>

      <div className="min-w-0 px-6 pt-6 pb-10 lg:px-10">
        <header className="space-y-4 pb-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">HTTP API</h1>
            <Button asChild size="sm">
              <Link href="/api-keys">
                <KeyRound className="mr-1 h-4 w-4" /> Manage tokens
              </Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Every action in the console is an HTTP call. Authenticate with a
            personal token as a <code>Bearer</code> credential; a token acts as
            you and can only do what your role + project memberships allow.
          </p>

          <div className="grid gap-3 md:grid-cols-3">
            <InfoCard label="Base URL" body={base} />
            <InfoCard
              label="Auth header"
              body="Authorization: Bearer sgk_xxxxxxxxxxxx"
            />
            <InfoCard
              label="Set your shell"
              body={`export SGEN="${base}"
export SGEN_TOKEN="sgk_..."`}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Create a token at{" "}
            <Link
              href="/api-keys"
              className="underline underline-offset-2"
            >
              API tokens
            </Link>
            . Tokens are shown once at creation and stored hashed — rotate by
            creating a new token and revoking the old one.
          </p>
        </header>

        <section
          id="auth"
          className="space-y-2 scroll-mt-4 border-t border-border pt-5"
        >
          <h2 className="text-lg font-semibold tracking-tight">
            Authentication
          </h2>
          <p className="text-sm text-muted-foreground">
            Send <code>Authorization: Bearer &lt;token&gt;</code> on every
            request. The console&apos;s login cookie also works — the same
            routes back the UI — so an in-browser fetch from your account
            doesn&apos;t need a token. Tokens are minted at{" "}
            <Link
              href="/api-keys"
              className="underline underline-offset-2"
            >
              /api-keys
            </Link>
            .
          </p>
        </section>

        {!query && (
          <section
            id="recipes"
            className="space-y-5 scroll-mt-4 border-t border-border pt-5"
          >
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Recipes</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                End-to-end flows driven with <code>curl</code>. Set{" "}
                <code>$SGEN</code> + <code>$SGEN_TOKEN</code> first (see above).
              </p>
            </div>
            {RECIPES.map((r) => (
              <div
                key={r.id}
                id={r.id}
                className="scroll-mt-4 space-y-2.5 rounded-lg border border-border bg-muted/20 p-4"
              >
                <h3 className="text-base font-semibold tracking-tight">
                  {r.title}
                </h3>
                <div className="text-sm text-muted-foreground">{r.blurb}</div>
                {r.steps.map((s, i) => (
                  <CodeBlock key={i} label={s.label}>
                    {s.sample}
                  </CodeBlock>
                ))}
              </div>
            ))}
          </section>
        )}

        {grouped.map(({ group, items }) => (
          <div key={group.id}>
            <section
              id={group.id}
              className="scroll-mt-4 border-t border-border pt-5"
            >
              <h2 className="text-lg font-semibold tracking-tight">
                {group.title}
              </h2>
              {group.blurb && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {group.blurb}
                </p>
              )}
            </section>
            {items.map((e) => (
              <EndpointSection key={e.id} endpoint={e} />
            ))}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="border-t border-border py-12 text-center text-sm text-muted-foreground">
            No endpoints match <code>&quot;{query}&quot;</code>.
          </div>
        )}

        <section
          id="errors"
          className="mt-8 space-y-3 scroll-mt-4 border-t border-border pt-5"
        >
          <h2 className="text-xl font-semibold tracking-tight">Errors</h2>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Code</th>
                  <th className="px-3 py-2 text-left font-medium">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {ERROR_TABLE.map((row) => (
                  <tr key={row.code} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{row.code}</td>
                    <td className="px-3 py-2 text-xs">{row.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function InfoCard({ label, body }: { label: string; body: string }) {
  return (
    <div className="relative rounded-md border border-border bg-muted/30 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-foreground/90">
        {body}
      </pre>
      <CopyBtn text={body} />
    </div>
  );
}

function EndpointSection({ endpoint: e }: { endpoint: Endpoint }) {
  return (
    <section
      id={e.id}
      className="grid scroll-mt-4 gap-5 border-t border-border py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={e.method} />
          <code className="font-mono text-sm">{e.path}</code>
        </div>
        <h3 className="text-base font-semibold tracking-tight">{e.title}</h3>
        <div className="max-w-none text-sm">{e.description}</div>

        {e.parameters && e.parameters.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Parameters
            </h4>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-2.5 py-1.5 text-left text-xs font-medium">
                      Name
                    </th>
                    <th className="px-2.5 py-1.5 text-left text-xs font-medium">
                      In
                    </th>
                    <th className="px-2.5 py-1.5 text-left text-xs font-medium">
                      Type
                    </th>
                    <th className="px-2.5 py-1.5 text-left text-xs font-medium">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {e.parameters.map((p) => (
                    <tr
                      key={`${p.in}:${p.name}`}
                      className="border-t border-border align-top"
                    >
                      <td className="px-2.5 py-1.5 font-mono text-xs">
                        {p.name}
                        {p.required && (
                          <span className="ml-1 text-rose-600">*</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-xs text-muted-foreground">
                        {p.in}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
                        {p.type}
                      </td>
                      <td className="px-2.5 py-1.5 text-xs">{p.doc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <CodeBlock label="Request">{e.request.sample}</CodeBlock>
        <div className="space-y-2.5">
          {e.responses.map((r, i) => (
            <div key={i} className="space-y-1">
              <StatusBadge code={r.code} label={r.codeLabel} />
              {r.doc && (
                <p className="text-xs text-muted-foreground">{r.doc}</p>
              )}
              <CodeBlock label="Response">{r.sample}</CodeBlock>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
