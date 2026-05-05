"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiAssistButton } from "@/components/ai-assist-button";
import { useConfirm } from "@/components/confirm-dialog";
import { createTaxonomyNode, deleteTaxonomyNode } from "./actions";

interface Node {
  id: string;
  name: string;
  slug: string;
  path: string;
}

interface Provider {
  id: string;
  name: string;
  defaultModel: string | null;
}

export function TaxonomyEditor({
  projectId,
  taxonomyId,
  canWrite,
  providers,
  nodes,
}: {
  projectId: string;
  taxonomyId: string;
  canWrite: boolean;
  providers: Provider[];
  nodes: Node[];
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState<string | null>(null);
  const confirm = useConfirm();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const suggestOpen = searchParams.get("suggest") === "1";

  const setSuggestOpen = useCallback(
    (next: boolean) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (next) params.set("suggest", "1");
      else params.delete("suggest");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const existingNamesLower = useMemo(
    () => new Set(nodes.map((n) => n.name.trim().toLowerCase())),
    [nodes],
  );

  // Lowercase-trim string forwarded to the LLM as extraContext so it doesn't
  // re-suggest nodes that already exist.
  const aiAssistContext = useMemo(() => {
    if (nodes.length === 0) return "Existing nodes: (none)";
    return `Existing nodes (do not duplicate, case-insensitive):\n${nodes
      .map((n) => `- ${n.name}`)
      .join("\n")}`;
  }, [nodes]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    start(async () => {
      const res = await createTaxonomyNode({ projectId, taxonomyId, name });
      if ("error" in res && res.error) setError(res.error);
      else setName("");
    });
  }

  async function remove(n: Node) {
    const ok = await confirm({
      title: `Delete node "${n.name}"?`,
      body: "Conversations already labelled with this node keep the label, but new runs can no longer target it.",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    start(async () => {
      const res = await deleteTaxonomyNode(projectId, n.id);
      if ("error" in res && (res as { error?: string }).error)
        setError((res as { error: string }).error);
    });
  }

  function applySuggestions(data: Record<string, unknown>) {
    setError(null);
    // Tolerate either {names: [...]} (the new schema) or {name: "..."} (older).
    const raw =
      Array.isArray(data["names"])
        ? (data["names"] as unknown[])
        : typeof data["name"] === "string"
          ? [data["name"] as string]
          : [];
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const item of raw) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (existingNamesLower.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(trimmed);
    }
    if (cleaned.length === 0) {
      setError("LLM returned no new suggestions (all duplicates of existing nodes).");
      return;
    }
    setSuggestions(cleaned);
  }

  function dismissSuggestion(s: string) {
    setSuggestions((rest) => rest.filter((x) => x !== s));
  }

  async function addSuggestion(s: string) {
    setError(null);
    setAdding(s);
    const res = await createTaxonomyNode({ projectId, taxonomyId, name: s });
    setAdding(null);
    if ("error" in res && res.error) {
      setError(`"${s}": ${res.error}`);
    } else {
      setSuggestions((rest) => rest.filter((x) => x !== s));
    }
  }

  async function addAllSuggestions() {
    setError(null);
    const failed: string[] = [];
    for (const s of [...suggestions]) {
      setAdding(s);
      const res = await createTaxonomyNode({ projectId, taxonomyId, name: s });
      if ("error" in res && res.error) failed.push(`"${s}": ${res.error}`);
      else setSuggestions((rest) => rest.filter((x) => x !== s));
    }
    setAdding(null);
    if (failed.length > 0) {
      setError(`Failed to add ${failed.length} node(s):\n${failed.join("\n")}`);
    }
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="space-y-2">
          <form onSubmit={add} className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. billing, modem-troubleshooting, plan-upgrade"
              disabled={pending}
            />
            <Button type="submit" disabled={pending}>
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
            <AiAssistButton
              projectId={projectId}
              kind="taxonomy-node"
              providers={providers}
              placeholder="3-8 taxonomy nodes for a Malaysian telco postpaid customer-care assistant."
              extraContext={aiAssistContext}
              onApply={applySuggestions}
              buttonLabel="Suggest"
              size="default"
              open={suggestOpen}
              onOpenChange={setSuggestOpen}
            />
          </form>
          {error && (
            <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              Suggestions ({suggestions.length})
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSuggestions([])}
                disabled={adding !== null}
              >
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={addAllSuggestions}
                disabled={adding !== null}
              >
                Add all
              </Button>
            </div>
          </div>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li
                key={s}
                className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1 text-sm"
              >
                <span className="font-medium">{s}</span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addSuggestion(s)}
                    disabled={adding !== null}
                  >
                    {adding === s ? "Adding…" : "Add"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => dismissSuggestion(s)}
                    disabled={adding !== null}
                    aria-label="Dismiss"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No nodes yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {nodes.map((n) => (
            <li key={n.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{n.name}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{n.path}</span>
              </div>
              {canWrite && (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  onClick={() => remove(n)}
                  aria-label="Delete node"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
