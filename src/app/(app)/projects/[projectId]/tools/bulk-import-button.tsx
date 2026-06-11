"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bulkImportToolDefs, type BulkImportItemResult } from "./actions";

type BulkResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  results: BulkImportItemResult[];
};

// One-shot importer: user pastes a JSON ARRAY of OpenAI tool definitions
// (each item with `name`, `description`, `parameters`, optionally `stage`
// + `returns`). The server action validates each entry independently and
// reports per-item outcomes so a single bad row doesn't abort the batch.
export function BulkImportButton({
  projectId,
  catalogId,
}: {
  projectId: string;
  catalogId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // URL-driven open state so the dialog is shareable / survives reload.
  // ?bulkImport=1 → open, anything else → closed. Trigger / close handlers
  // update the URL; the dialog reads from it on each render.
  const urlOpen = searchParams.get("bulkImport") === "1";
  const setOpen = useCallback(
    (next: boolean) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (next) params.set("bulkImport", "1");
      else params.delete("bulkImport");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const open = urlOpen;
  const [json, setJson] = useState("");
  const [mode, setMode] = useState<"skip" | "overwrite">("skip");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  // Clear transient form state whenever the dialog is closed via URL nav,
  // so reopening from the trigger doesn't show stale results.
  useEffect(() => {
    if (!open) {
      setError(null);
      setResult(null);
    }
  }, [open]);

  // Lightweight client-side preview: parse on every keystroke so the user
  // can see "N tools detected" before submitting. Errors are silent here
  // — the server validates authoritatively on submit.
  const parsedPreview = (() => {
    if (!json.trim()) return null;
    try {
      const v = JSON.parse(json);
      if (Array.isArray(v)) {
        const names = v
          .map((x) =>
            x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string"
              ? ((x as { name: string }).name)
              : null,
          )
          .filter((n): n is string => !!n);
        return { count: v.length, names };
      }
      return null;
    } catch {
      return null;
    }
  })();

  function onSubmit() {
    setError(null);
    setResult(null);
    start(async () => {
      const res = await bulkImportToolDefs({
        projectId,
        catalogId,
        json,
        mode,
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if ("results" in res && Array.isArray(res.results)) {
        setResult({
          total: res.total ?? 0,
          created: res.created ?? 0,
          updated: res.updated ?? 0,
          skipped: res.skipped ?? 0,
          failed: res.failed ?? 0,
          results: res.results,
        });
        router.refresh();
      }
    });
  }

  function closeAndReset() {
    setOpen(false);
    setJson("");
    setError(null);
    setResult(null);
    setMode("skip");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Bulk import
        </Button>
      </DialogTrigger>
      <DialogContent
        // Wider AND height-capped so a huge pasted JSON doesn't push the
        // footer (with the Import button) past the bottom of the viewport.
        // The scroll lives on the BODY between header + footer; the
        // footer stays pinned so Import/Cancel are always reachable.
        className="flex max-h-[85vh] w-[min(96vw,1100px)] max-w-none flex-col gap-0 p-0 sm:max-w-none"
      >
        <DialogHeader className="border-b border-border p-4 pb-3">
          <DialogTitle>Bulk import tool definitions</DialogTitle>
          <DialogDescription>
            Paste a JSON array of OpenAI-shape tool definitions. Each item
            needs <code>name</code> (snake_case), <code>description</code>,
            and <code>parameters</code> (JSON Schema). Optional{" "}
            <code>stage</code> is stored as a locale preset; optional{" "}
            <code>returns</code> is appended to the description.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="bulk-json" className="text-xs">
                JSON
              </Label>
              {parsedPreview && (
                <span className="text-[11px] text-muted-foreground">
                  {parsedPreview.count} item{parsedPreview.count === 1 ? "" : "s"}{" "}
                  detected
                </span>
              )}
            </div>
            <Textarea
              id="bulk-json"
              value={json}
              onChange={(e) => setJson(e.target.value)}
              // Bounded internal scroll on the textarea itself so a 38-tool
              // paste doesn't blow the dialog body out vertically; the
              // textarea grows up to ~50vh of content, then scrolls.
              className="max-h-[50vh] min-h-[260px] resize-none overflow-y-auto font-mono text-xs"
              placeholder={`[\n  {\n    "name": "lookup_customer",\n    "description": "Look up a customer record by identifier.",\n    "stage": "extract",\n    "parameters": {\n      "type": "object",\n      "properties": { "identifier": { "type": "string" } },\n      "required": ["identifier"]\n    },\n    "returns": "Customer record with profile + last 30d activity."\n  }\n]`}
            />
          </div>

          <div className="flex items-center gap-3">
            <Label className="text-xs">Existing name → </Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "skip" | "overwrite")}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">skip (default)</SelectItem>
                <SelectItem value="overwrite">overwrite + bump version</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
              {error}
            </p>
          )}

          {result && (
            <div className="space-y-2 rounded-md border border-border bg-muted/20 p-2 text-xs">
              <div>
                <strong>{result.total}</strong> item{result.total === 1 ? "" : "s"} processed ·{" "}
                <span className="text-emerald-700 dark:text-emerald-400">
                  {result.created} created
                </span>{" "}
                ·{" "}
                <span className="text-blue-700 dark:text-blue-400">
                  {result.updated} updated
                </span>{" "}
                ·{" "}
                <span className="text-muted-foreground">{result.skipped} skipped</span>
                {result.failed > 0 && (
                  <>
                    {" "}·{" "}
                    <span className="text-destructive">{result.failed} failed</span>
                  </>
                )}
              </div>
              {result.failed > 0 && (
                <details className="rounded border border-destructive/30 bg-destructive/5">
                  <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-medium">
                    Show {result.failed} failure{result.failed === 1 ? "" : "s"}
                  </summary>
                  <ul className="space-y-1 px-3 py-2 text-[11px]">
                    {result.results
                      .filter((r) => !r.ok)
                      .map((r, i) => (
                        <li key={i} className="font-mono">
                          [{(r as { index: number }).index}]{" "}
                          {(r as { name: string | null }).name ?? "<no name>"} —{" "}
                          {(r as { error: string }).error}
                        </li>
                      ))}
                  </ul>
                </details>
              )}
              <details className="rounded border border-border bg-background/40">
                <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-medium">
                  Show {result.results.filter((r) => r.ok).length} successful
                </summary>
                <ul className="space-y-0.5 px-3 py-2 text-[11px]">
                  {result.results
                    .filter((r): r is Extract<BulkImportItemResult, { ok: true }> => r.ok)
                    .map((r, i) => (
                      <li key={i} className="font-mono">
                        {r.action === "created" ? "+" : "↻"} {r.name}
                      </li>
                    ))}
                </ul>
              </details>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border bg-background/95 p-4">
          <Button type="button" variant="ghost" onClick={closeAndReset} disabled={pending}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button
              type="button"
              onClick={onSubmit}
              disabled={pending || !json.trim()}
            >
              {pending ? "Importing…" : "Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
