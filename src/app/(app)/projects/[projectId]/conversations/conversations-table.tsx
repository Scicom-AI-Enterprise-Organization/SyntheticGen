"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Eye, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";
import { ConversationDrawer } from "./conversation-drawer";
import { deleteConversation, deleteConversations } from "./actions";

interface Row {
  id: string;
  runId: string | null;
  primaryLanguage: string | null;
  primaryScript: string | null;
  difficulty: string | null;
  turnCount: number;
  tokenCount: number;
  status: string;
  createdAt: string;
  persona: string | null;
  topic: string | null;
}

export type SortField = "createdAt" | "turnCount" | "tokenCount";
export type SortDir = "asc" | "desc";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  generated: "secondary",
  accepted: "default",
  rejected: "destructive",
  flagged: "outline",
  annotated: "default",
};

const STATUS_OPTIONS = ["generated", "accepted", "rejected", "flagged", "annotated"];
const ALL = "__all__";

export function ConversationsTable({
  projectId,
  initialFocusId,
  conversations,
  initialTab,
  canDelete = false,
  taxonomyNodes,
  languages,
  page,
  totalPages,
  totalCount,
  pageSize,
  sort,
  dir,
  filters,
}: {
  projectId: string;
  initialFocusId: string | null;
  conversations: Row[];
  taxonomyNodes: { id: string; name: string }[];
  languages: string[];
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  sort: SortField;
  dir: SortDir;
  filters: { topic: string | null; lang: string | null; status: string | null };
  initialTab?: "messages" | "trace";
  canDelete?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Focused conversation lives in `?focus=<id>` — passed down by the server
  // page so SSR and CSR agree exactly. We deliberately don't call
  // `useSearchParams()` during render: Radix Select's `useId()` drifts between
  // server and client when the hook is read here (hydration warning on the
  // aria-controls attribute).
  const focusId = initialFocusId ?? null;
  const confirm = useConfirm();
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Bulk-selection. Lives client-side only; cleared when the page changes
  // (a fresh list of rows means stale ids would silently no-op anyway).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkErrors, setBulkErrors] = useState<Array<{ id: string; error: string }>>([]);

  // Drop selections that aren't on the current page (e.g. after pagination /
  // filter change). Cheap O(n) over the visible rows.
  const visibleIds = new Set(conversations.map((c) => c.id));
  const selectedOnPage = Array.from(selected).filter((id) => visibleIds.has(id));
  const allOnPageChecked =
    conversations.length > 0 && selectedOnPage.length === conversations.length;
  const someOnPageChecked = selectedOnPage.length > 0 && !allOnPageChecked;

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function togglePage(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) for (const c of conversations) next.add(c.id);
      else for (const c of conversations) next.delete(c.id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
    setBulkErrors([]);
  }

  async function onBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `Delete ${ids.length} conversation${ids.length === 1 ? "" : "s"}?`,
      body: `Each conversation's messages, reasoning, validations and JobEvent timeline are removed permanently. Any that are part of a frozen dataset version will be skipped.`,
      destructive: true,
    });
    if (!ok) return;
    setDeleteError(null);
    setBulkErrors([]);
    // Close the drawer if we're deleting the focused row.
    if (focusId && selected.has(focusId)) setParams({ focus: null });
    startDelete(async () => {
      const res = await deleteConversations(projectId, ids);
      setBulkErrors(res.errors);
      // Drop the ones that succeeded from the local selection set.
      const failedIds = new Set(res.errors.map((e) => e.id));
      setSelected((prev) => {
        const next = new Set<string>();
        for (const id of prev) if (failedIds.has(id)) next.add(id);
        return next;
      });
      router.refresh();
    });
  }

  async function onDelete(c: Row) {
    const ok = await confirm({
      title: "Delete this conversation?",
      body: `The conversation, its messages, reasoning, validations and JobEvent timeline are removed permanently. If it's part of a frozen dataset version, the delete is blocked.`,
      destructive: true,
    });
    if (!ok) return;
    setDeleteError(null);
    // Close the drawer if we're deleting the focused row.
    if (focusId === c.id) setParams({ focus: null });
    startDelete(async () => {
      const res = await deleteConversation(projectId, c.id);
      if ("error" in res && (res as { error?: string }).error) {
        setDeleteError((res as { error: string }).error);
      } else {
        router.refresh();
      }
    });
  }

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      // Read live URL only inside the event handler — never during render.
      const params = new URLSearchParams(window.location.search);
      let touchedFilterOrSort = false;
      for (const [k, v] of Object.entries(updates)) {
        if (v && v !== ALL) params.set(k, v);
        else params.delete(k);
        if (k !== "page" && k !== "focus") touchedFilterOrSort = true;
      }
      if (touchedFilterOrSort && !("page" in updates)) params.delete("page");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  function toggleSort(field: SortField) {
    if (sort === field) {
      setParams({ sort: field, dir: dir === "asc" ? "desc" : "asc" });
    } else {
      setParams({ sort: field, dir: "desc" });
    }
  }

  const anyFilter = filters.topic || filters.lang || filters.status;

  const startIdx = (page - 1) * pageSize + 1;
  const endIdx = Math.min(page * pageSize, totalCount);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Label className="text-[11px] text-muted-foreground">Topic</Label>
          <Select
            value={filters.topic ?? ALL}
            onValueChange={(v) => setParams({ topic: v })}
          >
            <SelectTrigger size="sm" className="h-7 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All topics</SelectItem>
              {taxonomyNodes.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Label className="text-[11px] text-muted-foreground">Lang</Label>
          <Select
            value={filters.lang ?? ALL}
            onValueChange={(v) => setParams({ lang: v })}
          >
            <SelectTrigger size="sm" className="h-7 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              {languages.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Label className="text-[11px] text-muted-foreground">Status</Label>
          <Select
            value={filters.status ?? ALL}
            onValueChange={(v) => setParams({ status: v })}
          >
            <SelectTrigger size="sm" className="h-7 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {anyFilter && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-[11px]"
            onClick={() => setParams({ topic: null, lang: null, status: null })}
          >
            <X className="mr-1 h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      {deleteError && (
        <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {deleteError}
        </p>
      )}

      {canDelete && selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <span>
            <span className="font-semibold">{selected.size}</span> selected
            {selectedOnPage.length !== selected.size && (
              <span className="ml-2 text-muted-foreground">
                ({selectedOnPage.length} on this page)
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              disabled={deleting}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={onBulkDelete}
              disabled={deleting}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              {deleting ? "Deleting…" : `Delete ${selected.size}`}
            </Button>
          </div>
        </div>
      )}

      {bulkErrors.length > 0 && (
        <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <div className="font-semibold">
            {bulkErrors.length} could not be deleted:
          </div>
          <ul className="ml-4 list-disc space-y-0.5">
            {bulkErrors.slice(0, 10).map((e) => (
              <li key={e.id} className="break-words">
                <span className="font-mono">{e.id.slice(0, 8)}…</span> — {e.error}
              </li>
            ))}
            {bulkErrors.length > 10 && (
              <li className="text-muted-foreground">
                …and {bulkErrors.length - 10} more
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Table */}
      {conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No conversations match the current filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                {canDelete && (
                  <th className="w-8 py-2 pr-2">
                    <Checkbox
                      aria-label="Select all on this page"
                      checked={
                        allOnPageChecked
                          ? true
                          : someOnPageChecked
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={(v) => togglePage(v === true)}
                    />
                  </th>
                )}
                <th className="py-2 pr-4 font-medium">
                  <SortHeader
                    label="Created"
                    field="createdAt"
                    activeSort={sort}
                    activeDir={dir}
                    onClick={toggleSort}
                  />
                </th>
                <th className="py-2 pr-4 font-medium">Persona</th>
                <th className="py-2 pr-4 font-medium">Topic</th>
                <th className="py-2 pr-4 font-medium">Lang</th>
                <th className="py-2 pr-4 font-medium">
                  <SortHeader
                    label="Turns"
                    field="turnCount"
                    activeSort={sort}
                    activeDir={dir}
                    onClick={toggleSort}
                  />
                </th>
                <th className="py-2 pr-4 font-medium">
                  <SortHeader
                    label="Tokens"
                    field="tokenCount"
                    activeSort={sort}
                    activeDir={dir}
                    onClick={toggleSort}
                  />
                </th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pl-4" />
              </tr>
            </thead>
            <tbody>
              {conversations.map((c) => (
                <tr key={c.id} className="border-b border-border/50 align-top">
                  {canDelete && (
                    <td className="w-8 py-3 pr-2">
                      <Checkbox
                        aria-label={`Select conversation ${c.id}`}
                        checked={selected.has(c.id)}
                        onCheckedChange={() => toggleRow(c.id)}
                      />
                    </td>
                  )}
                  <td className="py-3 pr-4 text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 text-xs">{c.persona ?? "—"}</td>
                  <td className="py-3 pr-4 text-xs">{c.topic ?? "—"}</td>
                  <td className="py-3 pr-4 text-xs">
                    {c.primaryLanguage ?? "—"}
                    {c.primaryScript && (
                      <span className="ml-1 text-muted-foreground">/{c.primaryScript}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs">{c.turnCount}</td>
                  <td className="py-3 pr-4 text-xs">{c.tokenCount}</td>
                  <td className="py-3 pr-4">
                    <Badge variant={STATUS_VARIANT[c.status] ?? "outline"} className="text-[10px]">
                      {c.status}
                    </Badge>
                  </td>
                  <td className="py-3 pl-4 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setParams({ focus: c.id })}
                        aria-label="View conversation"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDelete(c)}
                          disabled={deleting}
                          aria-label="Delete conversation"
                          title="Delete conversation"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span>
          {totalCount === 0
            ? "0 results"
            : `Showing ${startIdx}–${endIdx} of ${totalCount}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setParams({ page: String(page - 1) })}
          >
            <ChevronLeft className="h-3 w-3" />
            Prev
          </Button>
          <span className="px-2 font-mono">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setParams({ page: String(page + 1) })}
          >
            Next
            <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {focusId && (
        <ConversationDrawer
          projectId={projectId}
          conversationId={focusId}
          initialTab={initialTab}
          onClose={() => setParams({ focus: null, tab: null })}
        />
      )}
    </div>
  );
}

function SortHeader({
  label,
  field,
  activeSort,
  activeDir,
  onClick,
}: {
  label: string;
  field: SortField;
  activeSort: SortField;
  activeDir: SortDir;
  onClick: (f: SortField) => void;
}) {
  const active = activeSort === field;
  return (
    <button
      type="button"
      onClick={() => onClick(field)}
      title={`Sort by ${label.toLowerCase()}`}
      className={`inline-flex items-center gap-1 text-left hover:text-foreground ${active ? "text-foreground" : ""}`}
    >
      {label}
      {active ? (
        activeDir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}
