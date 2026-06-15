"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function ApiKeyPanel() {
  const [tokens, setTokens] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const [rawDialog, setRawDialog] = useState<{ raw: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [confirmRevoke, setConfirmRevoke] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  const refetch = useCallback(async (spinner = false) => {
    if (spinner) setLoading(true);
    try {
      const res = await fetch("/api/api-keys", { cache: "no-store" });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const rows = (await res.json()) as ApiKeyRow[];
      setTokens(rows);
      setListErr(null);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function handleCreate() {
    const trimmed = name.trim();
    setCreateErr(null);
    if (!trimmed) return;
    setCreating(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `http ${res.status}`);
      setRawDialog({ raw: j.raw, name: trimmed });
      setName("");
      void refetch();
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(t: ApiKeyRow) {
    setConfirmRevoke(null);
    setListErr(null);
    setRevoking(true);
    try {
      const res = await fetch(`/api/api-keys/${t.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`http ${res.status}`);
      void refetch();
    } catch (e) {
      setListErr(
        e instanceof Error ? e.message : `Failed to revoke "${t.name}"`,
      );
    } finally {
      setRevoking(false);
    }
  }

  async function copyToken(s: string) {
    try {
      await navigator.clipboard?.writeText(s);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked in insecure contexts — the visible <pre>
      // is selectable so the user can still copy manually.
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create a new token</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="e.g. agent-debug, laptop, ci-bot"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setCreateErr(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="max-w-sm"
            />
            <Button onClick={handleCreate} disabled={creating || !name.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
          {createErr && (
            <p className="text-xs text-destructive">{createErr}</p>
          )}
          <p className="text-xs text-muted-foreground">
            A token inherits your role + project memberships — it can do
            whatever you can. The raw token is shown <strong>exactly once</strong>,
            so copy it now.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your tokens</CardTitle>
        </CardHeader>
        <CardContent>
          {listErr && (
            <p className="mb-2 text-xs text-destructive">{listErr}</p>
          )}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You don&apos;t have any tokens yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Prefix</th>
                    <th className="px-3 py-2 text-left font-medium">Created</th>
                    <th className="px-3 py-2 text-left font-medium">Last used</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tokens.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2 font-medium">{t.name}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {t.prefix}…
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        <span suppressHydrationWarning>{fmtDate(t.createdAt)}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {t.lastUsedAt ? (
                          <span suppressHydrationWarning>{fmtDate(t.lastUsedAt)}</span>
                        ) : (
                          "never"
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                          active
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Revoke"
                          disabled={revoking}
                          onClick={() => setConfirmRevoke(t)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!rawDialog}
        onOpenChange={(o) => {
          if (!o) {
            setRawDialog(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New token — {rawDialog?.name}</DialogTitle>
            <DialogDescription>
              Copy this now. We never show the raw token again — only a prefix
              for identification.
            </DialogDescription>
          </DialogHeader>
          <pre className="break-all rounded-md border border-border bg-muted p-3 font-mono text-xs">
            {rawDialog?.raw}
          </pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => copyToken(rawDialog?.raw ?? "")}
              aria-live="polite"
            >
              {copied ? (
                <>
                  <Check className="mr-1 h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1 h-3.5 w-3.5" /> Copy
                </>
              )}
            </Button>
            <Button onClick={() => setRawDialog(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmRevoke}
        onOpenChange={(o) => !o && setConfirmRevoke(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {confirmRevoke?.name}?</DialogTitle>
            <DialogDescription>
              Any script using this token starts getting{" "}
              <code>401 Unauthorized</code> immediately. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRevoke(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRevoke && handleRevoke(confirmRevoke)}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
