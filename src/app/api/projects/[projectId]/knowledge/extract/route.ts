import { NextRequest } from "next/server";
import { extractText } from "unpdf";
import mammoth from "mammoth";
import { convert as htmlToText } from "html-to-text";
import { requireUser } from "@/lib/rbac";
import { checkProjectPermission } from "@/lib/project-rbac";

export const runtime = "nodejs";
// Allow up to 30s for big PDFs.
export const maxDuration = 30;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "missing `file` field" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `File is ${Math.round(file.size / 1024 / 1024)} MB; max ${MAX_BYTES / 1024 / 1024} MB` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const lowerName = (file.name || "").toLowerCase();
  const kind = guessKind(lowerName, file.type);

  let text = "";
  let pageCount: number | null = null;
  try {
    if (kind === "pdf") {
      const out = await extractText(new Uint8Array(buf), { mergePages: true });
      text = Array.isArray(out.text) ? out.text.join("\n\n") : (out.text ?? "");
      pageCount = out.totalPages ?? null;
    } else if (kind === "docx") {
      const out = await mammoth.extractRawText({ buffer: buf });
      text = out.value ?? "";
    } else if (kind === "html") {
      text = htmlToText(buf.toString("utf8"), {
        wordwrap: false,
        selectors: [
          { selector: "a", options: { ignoreHref: true } },
          { selector: "img", format: "skip" },
          { selector: "script", format: "skip" },
          { selector: "style", format: "skip" },
        ],
      });
    } else if (kind === "text") {
      text = buf.toString("utf8");
    } else {
      return Response.json(
        { error: `Unsupported file type "${file.type || lowerName}". Use PDF, DOCX, HTML, or TXT.` },
        { status: 415 },
      );
    }
  } catch (e) {
    return Response.json(
      { error: `Extraction failed: ${(e as Error).message}` },
      { status: 422 },
    );
  }

  // Collapse weird whitespace runs but keep paragraph breaks intact.
  text = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let truncated = false;
  if (text.length > MAX_CONTENT_CHARS) {
    text = text.slice(0, MAX_CONTENT_CHARS) + "\n\n…[truncated]";
    truncated = true;
  }

  const baseName = (file.name || "").replace(/\.[^.]+$/, "").trim();
  const title = baseName || "Untitled";

  return Response.json({
    title,
    content: text,
    sourceType: kind,
    bytes: file.size,
    truncated,
    pageCount,
  });
}

function guessKind(lowerName: string, mime: string): "pdf" | "docx" | "html" | "text" | "unknown" {
  if (mime === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  ) {
    return "docx";
  }
  if (mime === "text/html" || lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
    return "html";
  }
  if (mime.startsWith("text/") || lowerName.endsWith(".txt") || lowerName.endsWith(".md")) {
    return "text";
  }
  return "unknown";
}
