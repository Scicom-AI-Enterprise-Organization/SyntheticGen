"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Globe, Loader2, Plus, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createKnowledgeEntry, updateKnowledgeEntry } from "./actions";

interface CrawlOption {
  id: string;
  startUrl: string;
  status: string;
  pagesCount: number;
  pages: {
    url: string;
    depth: number;
    title: string;
    content: string;
    contentChars: number;
  }[];
}

interface TaxonomyNode {
  id: string;
  name: string;
}

interface ProviderOption {
  id: string;
  name: string;
  defaultModel: string | null;
}

export interface ExistingEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  taxonomyNodeIds: string[];
  sourceUrl: string | null;
}

export function KnowledgeForm({
  projectId,
  taxonomyNodes,
  providers,
  crawls = [],
  existing,
  onSaved,
  card,
}: {
  projectId: string;
  taxonomyNodes: TaxonomyNode[];
  providers: ProviderOption[];
  crawls?: CrawlOption[];
  existing?: ExistingEntry;
  onSaved?: () => void;
  card?: { title: string; description?: string };
}) {
  const isEdit = Boolean(existing);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [content, setContent] = useState(existing?.content ?? "");
  // Auto-collapse very long content (typical right after a crawl/doc import) so
  // the form stays scannable. User clicks "Expand to edit" to reveal the full
  // textarea. Small content is always shown directly.
  const [contentExpanded, setContentExpanded] = useState(
    (existing?.content?.length ?? 0) <= 1500,
  );
  const [tags, setTags] = useState((existing?.tags ?? []).join(", "));
  const [sourceUrl, setSourceUrl] = useState(existing?.sourceUrl ?? "");
  const [nodeIds, setNodeIds] = useState<string[]>(existing?.taxonomyNodeIds ?? []);
  const [providerId, setProviderId] = useState<string>(providers[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillStatus, setAutofillStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autofillAbortRef = useRef<AbortController | null>(null);
  const [pending, start] = useTransition();

  // Crawl-import state — picks a cached crawl + page subset to merge into one entry.
  const [crawlPickerOpen, setCrawlPickerOpen] = useState(false);
  const [pickedCrawlId, setPickedCrawlId] = useState<string>("");
  const [pickedPageUrls, setPickedPageUrls] = useState<Set<string>>(new Set());
  const finishedCrawls = useMemo(
    () => crawls.filter((c) => c.pagesCount > 0),
    [crawls],
  );
  const pickedCrawl = useMemo(
    () => finishedCrawls.find((c) => c.id === pickedCrawlId) ?? null,
    [finishedCrawls, pickedCrawlId],
  );

  function toggleNode(id: string) {
    setNodeIds((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));
  }

  // After we've pulled raw text out of a doc, ask the LLM to clean it up,
  // pick a title and pre-tick the taxonomy nodes the entry is relevant to.
  async function runAutofill(rawContent: string) {
    if (!providerId) return;
    if (rawContent.length < 80) return; // not worth the LLM hop
    setAutofilling(true);
    setAutofillStatus("Asking the LLM to draft a title and pick taxonomy nodes…");

    const taxonomyCatalog =
      taxonomyNodes.length === 0
        ? "(none configured)"
        : taxonomyNodes.map((n) => `- id: ${n.id}\n  name: ${n.name}`).join("\n");

    const controller = new AbortController();
    autofillAbortRef.current = controller;

    try {
      const res = await fetch(
        `/api/projects/${projectId}/ai-assist?stream=1`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "knowledge-entry",
            prompt:
              "Turn the document below into a knowledge-base entry. Preserve every concrete fact. Pick a concise title and the taxonomy nodes (by ID) that this doc is relevant to.",
            providerId,
            extraContext: `AVAILABLE_TAXONOMY:\n${taxonomyCatalog}\n\nDOCUMENT:\n${rawContent.slice(0, 80_000)}`,
            maxTokens: 32_000,
          }),
          signal: controller.signal,
        },
      );
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `http ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalData: Record<string, unknown> | null = null;
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
          try { evt = JSON.parse(trimmed); } catch { continue; }
          if (evt.type === "delta") {
            // (silent — we wait for the full JSON before swapping content)
          } else if (evt.type === "done") {
            finalData = (evt.data as Record<string, unknown>) ?? null;
            break outer;
          } else if (evt.type === "error") {
            throw new Error((evt.error as string) || "autofill failed");
          }
        }
      }

      if (finalData) {
        const t = finalData["title"];
        const c = finalData["content"];
        const tg = finalData["tags"];
        const tn = finalData["taxonomyNodeIds"];
        if (typeof t === "string" && t.trim()) setTitle(t.trim());
        if (typeof c === "string" && c.trim().length > 80) {
          setContent(c);
          setContentExpanded(c.length <= 1500);
        }
        if (Array.isArray(tg)) {
          setTags(
            (tg as unknown[]).filter((x): x is string => typeof x === "string").join(", "),
          );
        }
        if (Array.isArray(tn)) {
          const validIds = new Set(taxonomyNodes.map((n) => n.id));
          const picked = (tn as unknown[]).filter(
            (x): x is string => typeof x === "string" && validIds.has(x),
          );
          if (picked.length > 0) setNodeIds(picked);
        }
        setAutofillStatus(
          `Title + ${Array.isArray(tn) ? (tn as unknown[]).length : 0} taxonomy node(s) auto-filled. Review before saving.`,
        );
      } else {
        setAutofillStatus("LLM returned no usable payload.");
      }
    } catch (e) {
      const err = e as Error;
      if (err.name !== "AbortError") {
        setAutofillStatus(`Autofill failed: ${err.message}`);
      } else {
        setAutofillStatus("Autofill stopped.");
      }
    } finally {
      if (autofillAbortRef.current === controller) autofillAbortRef.current = null;
      setAutofilling(false);
    }
  }

  function onStopAutofill() {
    autofillAbortRef.current?.abort();
  }

  function togglePageUrl(url: string) {
    setPickedPageUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function selectCrawl(id: string) {
    setPickedCrawlId(id);
    const c = finishedCrawls.find((x) => x.id === id);
    setPickedPageUrls(new Set((c?.pages ?? []).map((p) => p.url)));
  }

  // Merge the picked pages into a single content body and chain into the same
  // LLM autofill the Upload doc flow uses.
  async function importCrawl() {
    if (!pickedCrawl) {
      setError("Pick a crawl first.");
      return;
    }
    const chosen = pickedCrawl.pages.filter((p) => pickedPageUrls.has(p.url));
    if (chosen.length === 0) {
      setError("Select at least one page to merge.");
      return;
    }
    setError(null);
    setSuccess(null);
    setAutofillStatus(null);

    // Don't shove entire docs into one entry. Cap per-page snippet AND total
    // merged size — the LLM autofill will turn this into the final cleaned
    // content. Heavy lifting (full doc fidelity) is the upload-doc flow's job.
    const MAX_PER_PAGE = 4_000;
    const MAX_TOTAL = 40_000;
    const snippets = chosen.map((p) => {
      const body = (p.content ?? "").trim();
      const snipped = body.length > MAX_PER_PAGE
        ? body.slice(0, MAX_PER_PAGE) + "\n\n…[snipped]"
        : body;
      return { title: p.title || p.url, url: p.url, body: snipped };
    });
    const parts: string[] = [];
    let runningLen = 0;
    let trimmedAtIdx = -1;
    for (let i = 0; i < snippets.length; i++) {
      const s = snippets[i];
      const block = `## Page ${i + 1}: ${s.title}\nURL: ${s.url}\n\n${s.body}`;
      if (runningLen + block.length > MAX_TOTAL && parts.length > 0) {
        trimmedAtIdx = i;
        break;
      }
      parts.push(block);
      runningLen += block.length + 7; // separator overhead
    }
    let merged = parts.join("\n\n---\n\n");
    if (trimmedAtIdx >= 0) {
      merged += `\n\n---\n\n…[${chosen.length - trimmedAtIdx} more page(s) omitted to stay under ${MAX_TOTAL} chars; pages stay cached if you need them]`;
    }

    // Default title to the crawl's start URL hostname; user / LLM can refine.
    try {
      if (!title.trim()) {
        const host = new URL(pickedCrawl.startUrl).hostname;
        setTitle(`${host} (${chosen.length} pages)`);
      }
    } catch {
      // ignore bad URL
    }
    if (!sourceUrl.trim()) setSourceUrl(pickedCrawl.startUrl);
    setContent(merged);
    setContentExpanded(merged.length <= 1500);
    const includedPages = trimmedAtIdx >= 0 ? trimmedAtIdx : chosen.length;
    const noteParts = [
      `Imported ${includedPages}/${chosen.length} page snippet${chosen.length === 1 ? "" : "s"} from ${pickedCrawl.startUrl}`,
      `≤${MAX_PER_PAGE} chars per page · ≤${MAX_TOTAL} chars total`,
    ];
    if (trimmedAtIdx >= 0) {
      noteParts.push(`${chosen.length - trimmedAtIdx} page(s) trimmed`);
    }
    setUploadInfo(noteParts.join(" · "));
    setCrawlPickerOpen(false);

    if (providerId && merged.length >= 80) {
      await runAutofill(merged);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
    setAutofillStatus(null);
    setUploadInfo(`Extracting ${file.name}…`);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/projects/${projectId}/knowledge/extract`, {
        method: "POST",
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `http ${res.status}`);
      const rawContent = typeof body.content === "string" ? body.content : "";
      // Initial fill (filename + raw text); the LLM may overwrite below.
      if (!title.trim() && typeof body.title === "string") setTitle(body.title);
      if (rawContent) {
        setContent(rawContent);
        setContentExpanded(rawContent.length <= 1500);
      }
      const bits = [
        `${body.sourceType ?? "file"}`,
        body.pageCount ? `${body.pageCount} pages` : null,
        `${Math.round((body.bytes ?? file.size) / 1024)} KB`,
        body.truncated ? "truncated to 50 000 chars" : null,
      ].filter(Boolean);
      setUploadInfo(`Imported ${file.name} (${bits.join(" · ")})`);

      // Then chain into the LLM autofill if a provider is selected.
      if (providerId && rawContent) {
        await runAutofill(rawContent);
      } else if (!providerId) {
        setAutofillStatus(
          "No provider selected — title is the filename and taxonomy isn't auto-ticked. Pick a provider above to enable LLM autofill.",
        );
      }
    } catch (e) {
      setUploadInfo(null);
      setError(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    start(async () => {
      const payload = {
        projectId,
        title,
        content,
        tags: tags.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean),
        taxonomyNodeIds: nodeIds,
        sourceUrl: sourceUrl.trim() || null,
      };
      const res = isEdit
        ? await updateKnowledgeEntry({ ...payload, id: existing!.id })
        : await createKnowledgeEntry(payload);
      if ("error" in res && res.error) {
        setError(res.error);
      } else if (isEdit) {
        setSuccess(`Entry “${title}” updated.`);
        onSaved?.();
      } else {
        setSuccess(`Entry “${title}” added.`);
        setTitle("");
        setContent("");
        setContentExpanded(true);
        setTags("");
        setSourceUrl("");
        setNodeIds([]);
      }
    });
  }

  const busy = uploading || autofilling;

  const fields = (
    <>
      {/* Upload first so we can use the LLM to autofill title + content + taxonomy. */}
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <Label className="mb-1 block text-[11px] text-muted-foreground">
          Provider (for LLM autofill)
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={providerId} onValueChange={setProviderId} disabled={busy}>
            <SelectTrigger size="sm" className="h-8 w-[260px] text-xs">
              <SelectValue placeholder={providers.length === 0 ? "no providers configured" : "Pick a provider"} />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.defaultModel && (
                    <span className="ml-1 text-muted-foreground">({p.defaultModel})</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.html,.htm,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html,text/plain"
            className="hidden"
            onChange={onFile}
            disabled={busy || pending}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || pending}
          >
            {uploading ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Upload className="mr-1 h-3 w-3" />
            )}
            {uploading ? "Extracting…" : "Upload doc"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCrawlPickerOpen((v) => !v)}
            disabled={busy || pending || finishedCrawls.length === 0}
            title={
              finishedCrawls.length === 0
                ? "Crawl a URL first (see URL crawls card below)"
                : "Merge cached crawl pages into this single entry"
            }
          >
            <Globe className="mr-1 h-3 w-3" />
            Import crawled pages{finishedCrawls.length > 0 ? ` (${finishedCrawls.length})` : ""}
          </Button>
          {autofilling ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onStopAutofill}
            >
              Stop autofill
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              After extract, the LLM drafts a title + auto-ticks taxonomy.
            </span>
          )}
        </div>
        {uploadInfo && (
          <p className="mt-2 text-[11px] text-muted-foreground">{uploadInfo}</p>
        )}
        {autofillStatus && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {autofilling && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
            {autofillStatus}
          </p>
        )}

        {crawlPickerOpen && finishedCrawls.length > 0 && (
          <div className="mt-3 space-y-3 rounded-md border border-border bg-background/60 p-3">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Cached crawl</Label>
              <Select value={pickedCrawlId} onValueChange={selectCrawl} disabled={busy}>
                <SelectTrigger size="sm" className="h-8 text-xs">
                  <SelectValue placeholder="Pick a cached crawl…" />
                </SelectTrigger>
                <SelectContent>
                  {finishedCrawls.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="truncate">{c.startUrl}</span>
                      <span className="ml-2 text-muted-foreground">
                        · {c.pagesCount} page{c.pagesCount === 1 ? "" : "s"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {pickedCrawl && (
              <>
                <div className="flex items-center justify-between text-[11px]">
                  <label className="inline-flex items-center gap-2">
                    <Checkbox
                      checked={
                        pickedPageUrls.size === pickedCrawl.pages.length
                          ? true
                          : pickedPageUrls.size === 0
                            ? false
                            : "indeterminate"
                      }
                      onCheckedChange={(v) =>
                        setPickedPageUrls(
                          v === true
                            ? new Set(pickedCrawl.pages.map((p) => p.url))
                            : new Set(),
                        )
                      }
                    />
                    {pickedPageUrls.size === pickedCrawl.pages.length
                      ? "Unselect all"
                      : "Select all"}
                  </label>
                  <span className="text-muted-foreground">
                    {pickedPageUrls.size} of {pickedCrawl.pages.length} selected
                  </span>
                </div>

                <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-border/70 bg-muted/30 p-2 font-mono text-[11px]">
                  {pickedCrawl.pages.map((p) => (
                    <label
                      key={p.url}
                      className="flex items-start gap-2 rounded p-1 hover:bg-background/50"
                    >
                      <Checkbox
                        checked={pickedPageUrls.has(p.url)}
                        onCheckedChange={() => togglePageUrl(p.url)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{p.title || p.url}</span>
                        <span className="block truncate text-muted-foreground">
                          {p.url} ·{" "}
                          <span className="text-[10px]">{p.contentChars} chars</span>
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Selected pages are merged into ONE entry. Provider above is used to
                  draft a title and auto-tick taxonomy after the merge.
                </p>

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCrawlPickerOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={importCrawl}
                    disabled={busy || pickedPageUrls.size === 0}
                  >
                    Use {pickedPageUrls.size || ""} page
                    {pickedPageUrls.size === 1 ? "" : "s"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="kb-title">Title</Label>
          <Input
            id="kb-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. TM postpaid plan caps & fees"
            required
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="kb-content">
              Content{" "}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                ({content.length.toLocaleString()} chars)
              </span>
            </Label>
            {content.length > 1500 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setContentExpanded((v) => !v)}
              >
                {contentExpanded ? "Collapse preview" : "Expand to edit"}
              </Button>
            )}
          </div>
          {contentExpanded || content.length <= 1500 ? (
            <Textarea
              id="kb-content"
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="The plan caps at 100GB. After cap, throttle to 1Mbps. Late-payment fee RM10 after 14 days."
              className="font-mono text-xs"
              required
            />
          ) : (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px] leading-snug">
              {content.slice(0, 1500)}
              {content.length > 1500 && "\n\n…[+" + (content.length - 1500).toLocaleString() + " more chars — click Expand to edit]"}
            </pre>
          )}
          <p className="text-[11px] text-muted-foreground">
            Plain text or markdown. Sent verbatim to the model alongside the system prompt.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="kb-tags">Tags (comma-separated)</Label>
          <Input
            id="kb-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="billing, postpaid, fees"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="kb-url">Source URL (optional)</Label>
          <Input
            id="kb-url"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://example.com/policies"
          />
        </div>
      </div>

      <div>
        <Label className="mb-2 block">
          Linked taxonomy nodes ({nodeIds.length} selected)
        </Label>
        {taxonomyNodes.length === 0 ? (
          <p className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            No taxonomy nodes yet. This entry will only be injected as a
            project-wide fallback until you create some.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 sm:grid-cols-3">
            {taxonomyNodes.map((n) => (
              <label key={n.id} className="flex items-start gap-2 text-xs">
                <Checkbox
                  checked={nodeIds.includes(n.id)}
                  onCheckedChange={() => toggleNode(n.id)}
                />
                <span>{n.name}</span>
              </label>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Empty selection = match every run in this project. Otherwise the entry
          is only injected when a run targets one of the linked nodes.
        </p>
      </div>

    </>
  );

  const errorBlock = error && (
    <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
      {error}
    </p>
  );
  const successBlock = success && (
    <p className="text-xs text-green-600" role="status">
      {success}
    </p>
  );
  const submitButton = (
    <Button type="submit" disabled={pending || busy}>
      <Plus className="mr-2 h-4 w-4" />
      {pending
        ? isEdit
          ? "Saving…"
          : "Adding…"
        : isEdit
          ? "Save changes"
          : "Add entry"}
    </Button>
  );

  if (card) {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{card.title}</CardTitle>
            {card.description && (
              <CardDescription>{card.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {fields}
            {errorBlock}
            {successBlock}
          </CardContent>
        </Card>
        <div className="flex justify-end">{submitButton}</div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {fields}
      <div className="space-y-2">
        {submitButton}
        {errorBlock}
        {successBlock}
      </div>
    </form>
  );
}
