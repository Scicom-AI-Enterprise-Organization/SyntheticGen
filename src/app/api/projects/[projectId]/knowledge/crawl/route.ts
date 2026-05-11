import { NextRequest } from "next/server";
import { convert as htmlToText } from "html-to-text";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  startUrl: z.string().url(),
  depth: z.number().int().min(0).max(3).default(1),
  maxPages: z.number().int().min(1).max(50).default(15),
  // Same-origin only by default. If false, the crawler ignores cross-origin links.
  sameOriginOnly: z.boolean().default(true),
});

const PER_PAGE_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_CONTENT_CHARS = 50_000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const user = await requireUser();
  const perm = await checkProjectPermission(user, projectId, "knowledge.write");
  if (!perm.ok) {
    return Response.json({ error: perm.reason }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.errors[0]?.message }, { status: 400 });
  }
  const { startUrl, depth, maxPages, sameOriginOnly } = parsed.data;

  // Open a cache row up front so partial results survive client disconnects.
  const crawl = await prisma.knowledgeCrawl.create({
    data: {
      projectId,
      startUrl,
      depth,
      maxPages,
      sameOriginOnly,
      status: "running",
      pages: [] as unknown as Prisma.InputJsonValue,
      createdById: user.id,
    },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          // controller closed
        }
      };

      const collected: Array<{
        url: string;
        depth: number;
        title: string;
        content: string;
        contentChars: number;
        truncated: boolean;
        bytes: number;
      }> = [];
      let aborted = false;
      let topLevelError: string | null = null;

      try {
        const start = new URL(startUrl);
        const visited = new Set<string>();
        const queue: { url: string; depth: number; from: string | null }[] = [
          { url: start.href, depth: 0, from: null },
        ];
        const origin = start.origin;

        send({
          type: "start",
          crawlId: crawl.id,
          startUrl: start.href,
          depth,
          maxPages,
          sameOriginOnly,
        });

        req.signal.addEventListener("abort", () => {
          aborted = true;
        });

        while (queue.length > 0 && visited.size < maxPages) {
          if (aborted) break;
          const { url, depth: d, from } = queue.shift()!;
          if (visited.has(url)) continue;
          visited.add(url);

          send({
            type: "fetching",
            url,
            depth: d,
            from,
            index: visited.size,
            total: Math.min(visited.size + queue.length, maxPages),
          });

          const result = await fetchPage(url, req.signal);
          if (result.kind === "error") {
            send({ type: "error", url, depth: d, error: result.error });
            continue;
          }
          if (result.kind === "skipped") {
            send({ type: "skipped", url, depth: d, reason: result.reason });
            continue;
          }

          const text = extractText(result.html);
          const truncated = text.length > MAX_CONTENT_CHARS;
          const content = truncated
            ? text.slice(0, MAX_CONTENT_CHARS) + "\n\n…[truncated]"
            : text;
          const title = extractTitle(result.html) || result.finalUrl;

          const page = {
            url: result.finalUrl,
            depth: d,
            title,
            content,
            contentChars: content.length,
            truncated,
            bytes: result.bytes,
          };
          collected.push(page);
          send({ type: "page", ...page });

          if (d < depth) {
            const links = extractLinks(result.html, result.finalUrl);
            for (const link of links) {
              if (sameOriginOnly && new URL(link).origin !== origin) continue;
              if (visited.has(link)) continue;
              queue.push({ url: link, depth: d + 1, from: result.finalUrl });
            }
          }
        }

        send({
          type: "done",
          crawlId: crawl.id,
          visited: visited.size,
          aborted,
        });
      } catch (e) {
        topLevelError = (e as Error).message;
        send({ type: "error", error: topLevelError });
      } finally {
        try {
          await prisma.knowledgeCrawl.update({
            where: { id: crawl.id },
            data: {
              status: topLevelError
                ? "failed"
                : aborted
                  ? "cancelled"
                  : "completed",
              pages: collected as unknown as Prisma.InputJsonValue,
              pagesCount: collected.length,
              errorMessage: topLevelError,
              completedAt: new Date(),
            },
          });
        } catch {
          // best effort
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

type FetchResult =
  | { kind: "html"; finalUrl: string; html: string; bytes: number }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; error: string };

async function fetchPage(url: string, signal: AbortSignal): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_PAGE_TIMEOUT_MS);
  signal.addEventListener("abort", () => controller.abort());
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "SyntheticGen-Knowledge-Crawler/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) {
      return { kind: "error", error: `HTTP ${res.status}` };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("html")) {
      return { kind: "skipped", reason: `not-html (${ct || "?"})` };
    }
    // Read body with a hard byte cap so a 50 MB page doesn't blow up memory.
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) {
      return { kind: "skipped", reason: `body too large (${buf.byteLength} bytes)` };
    }
    const html = Buffer.from(buf).toString("utf8");
    return { kind: "html", finalUrl: res.url || url, html, bytes: buf.byteLength };
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") return { kind: "error", error: "timed out" };
    return { kind: "error", error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return "";
  return m[1].replace(/\s+/g, " ").trim();
}

function extractText(html: string): string {
  return htmlToText(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "nav", format: "skip" },
      { selector: "footer", format: "skip" },
    ],
  })
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*?\bhref\s*=\s*["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const u = new URL(m[1], baseUrl);
      if (u.protocol === "https:" || u.protocol === "http:") {
        u.hash = "";
        out.add(u.href);
      }
    } catch {
      // bad href
    }
  }
  return [...out];
}
