"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, ChevronDown, Copy, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { setUserRoles, deleteUser, resetUserPassword } from "./users-actions";

interface User {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
  /** True when the user has a local bcrypt passwordHash. */
  hasLocalPassword: boolean;
  /** Linked OAuth providers, e.g. ["keycloak", "google"]. Excludes "credentials". */
  providers: string[];
  createdAt: string;
}

const NONE = "__none__";

function providerBadge(u: User): { label: string; tone: "primary" | "outline" } {
  if (u.hasLocalPassword) return { label: "Local", tone: "primary" };
  if (u.providers.length === 0) return { label: "—", tone: "outline" };
  const first = u.providers[0];
  return { label: first.charAt(0).toUpperCase() + first.slice(1), tone: "outline" };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function UsersTable({ users, allRoles }: { users: User[]; allRoles: string[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<{
    email: string;
    link: string;
    expiresAt: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  // Gate Radix Select on mount to avoid SSR/CSR useId mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const confirm = useConfirm();

  function changeRole(user: User, role: string) {
    setError(null);
    const next = role === NONE ? [] : [role];
    start(async () => {
      try {
        await setUserRoles(user.id, next);
      } catch {
        setError("Failed to update role");
      }
    });
  }

  async function onDelete(user: User) {
    const ok = await confirm({
      title: `Delete ${user.email}?`,
      body: "This permanently removes the user account.",
      confirmText: "Delete user",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    start(async () => {
      try {
        await deleteUser(user.id);
      } catch {
        setError("Failed to delete user");
      }
    });
  }

  function onResetPassword(user: User) {
    setError(null);
    setResetResult(null);
    setCopied(false);
    start(async () => {
      try {
        const res = await resetUserPassword(user.id);
        if ("error" in res && res.error) {
          setError(res.error);
          return;
        }
        if (res.ok) {
          setResetResult({ email: user.email, link: res.link, expiresAt: res.expiresAt });
          const ok = await navigator.clipboard.writeText(res.link).then(
            () => true,
            () => false,
          );
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }
      } catch {
        setError("Failed to generate reset link");
      }
    });
  }

  async function copyResetLink() {
    if (!resetResult) return;
    const ok = await navigator.clipboard.writeText(resetResult.link).then(
      () => true,
      () => false,
    );
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <Dialog
        open={Boolean(resetResult)}
        onOpenChange={(open) => {
          if (!open) setResetResult(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Password-reset link</DialogTitle>
            <DialogDescription>
              {resetResult ? (
                <>
                  Share this link with <strong>{resetResult.email}</strong> through a
                  secure channel. It is shown <strong>once</strong> and expires{" "}
                  {new Date(resetResult.expiresAt).toLocaleString()}. The user&apos;s
                  current password keeps working until they open this link and set a
                  new one.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {resetResult && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3">
              <code className="flex-1 truncate font-mono text-xs">
                {resetResult.link}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={copyResetLink}
                aria-label={copied ? "Copied" : "Copy link"}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResetResult(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="py-2 pr-4 font-medium">Provider</th>
              <th className="py-2 pr-4 font-medium">Created</th>
              <th className="py-2 pl-4 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const current = u.roles[0] ?? NONE;
              const prov = providerBadge(u);
              return (
                <tr key={u.id} className="border-b border-border/50">
                  <td className="py-3 pr-4">
                    <div className="font-medium">{u.name ?? "—"}</div>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{u.email}</td>
                  <td className="py-3 pr-4">
                    {mounted ? (
                      <Select
                        value={current}
                        onValueChange={(v) => changeRole(u, v)}
                        disabled={pending}
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`Role for ${u.email}`}
                          className="h-8! min-h-8! max-h-8! py-1! w-32"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
                          {allRoles.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div
                        aria-hidden
                        className="flex h-8 w-32 items-center justify-between rounded-md border border-input bg-transparent px-2 py-1 text-xs text-muted-foreground shadow-xs dark:bg-input/30"
                      >
                        <span className="truncate">{current === NONE ? "—" : current}</span>
                        <ChevronDown className="h-3 w-3 opacity-50" />
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <Badge
                      variant={prov.tone === "primary" ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {prov.label}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted-foreground">
                    {fmtDate(u.createdAt)}
                  </td>
                  <td className="py-3 pl-4 text-right">
                    <div className="flex justify-end gap-1">
                      {u.hasLocalPassword && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={pending}
                          onClick={() => onResetPassword(u)}
                          aria-label="Reset password"
                          title="Reset password"
                        >
                          <KeyRound className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        onClick={() => onDelete(u)}
                        aria-label="Delete user"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
