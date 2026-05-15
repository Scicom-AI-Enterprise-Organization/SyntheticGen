"use client";

import { useEffect, useState, useTransition } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { createInvitation } from "./actions";

const NO_ROLE = "__none__";

export function InviteForm({ roles, baseUrl }: { roles: string[]; baseUrl: string }) {
  const [email, setEmail] = useState("");
  const [roleName, setRoleName] = useState<string>(roles[0] ?? NO_ROLE);
  const [expiresInHours, setExpiresInHours] = useState("24");
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Radix Select uses useId() internally for aria-controls, which mismatches
  // between SSR and the first client render. Gate the Select on mount so it
  // renders client-only — the placeholder keeps layout while React hydrates.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address");
      return;
    }
    const hours = Number(expiresInHours);
    if (!Number.isFinite(hours) || hours < 1 || hours > 8760) {
      setError("Expires must be between 1 and 8760 hours");
      return;
    }

    start(async () => {
      const res = await createInvitation({
        email: trimmedEmail || undefined,
        roleName: roleName === NO_ROLE ? undefined : roleName,
        expiresInHours: hours,
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if (res.ok && res.token) {
        const link = `${baseUrl}/invite/${res.token}`;
        setLastLink(link);
        const ok = await navigator.clipboard.writeText(link).then(
          () => true,
          () => false,
        );
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
        setSuccess("Invite created — link copied to clipboard.");
        setEmail("");
      }
    });
  }

  async function copy() {
    if (!lastLink) return;
    const ok = await navigator.clipboard.writeText(lastLink).then(
      () => true,
      () => false,
    );
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="flex flex-1 flex-col justify-end gap-2">
          <Label htmlFor="invite-email">
            Email (optional — locks the invite if set)
          </Label>
          <Input
            id="invite-email"
            type="text"
            placeholder="alice@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex w-32 flex-col justify-end gap-2">
          <Label htmlFor="invite-role" className="whitespace-nowrap">Role</Label>
          {mounted ? (
            <Select value={roleName} onValueChange={setRoleName}>
              <SelectPrimitive.Trigger asChild>
                <button
                  id="invite-role"
                  type="button"
                  data-slot="select-trigger"
                  className="border-input dark:bg-input/30 flex h-9 w-full min-w-0 items-center justify-between rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                >
                  <SelectValue />
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </button>
              </SelectPrimitive.Trigger>
              <SelectContent>
                <SelectItem value={NO_ROLE}>None</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="border-input dark:bg-input/30 flex h-9 w-full min-w-0 items-center justify-between rounded-md border bg-transparent px-3 py-1 text-base shadow-xs md:text-sm"
            >
              <span className="truncate text-muted-foreground">
                {roleName === NO_ROLE ? "None" : roleName}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
            </button>
          )}
        </div>
        <div className="flex w-32 flex-col justify-end gap-2">
          <Label htmlFor="invite-expiry" className="whitespace-nowrap">Expires (hours)</Label>
          <Input
            id="invite-expiry"
            value={expiresInHours}
            onChange={(e) => setExpiresInHours(e.target.value)}
          />
        </div>
        <div className="flex flex-col justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Generating…" : "Generate link"}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        The link is shown <strong>once</strong> — the token is not stored in plain form
        and cannot be retrieved later. Admins can do everything; viewers are read-only
        (dashboards + job output, no submit/modify).
      </p>

      {error && (
        <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="text-xs text-green-600" role="status">
          {success}
        </p>
      )}

      {lastLink && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3">
          <code className="flex-1 truncate text-xs">{lastLink}</code>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={copy}
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
    </form>
  );
}
