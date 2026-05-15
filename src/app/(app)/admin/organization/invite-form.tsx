"use client";

import { useState, useTransition } from "react";
import { Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createInvitation } from "./actions";

const NO_ROLE = "__none__";

export function InviteForm({ roles, baseUrl }: { roles: string[]; baseUrl: string }) {
  const [email, setEmail] = useState("");
  const [roleName, setRoleName] = useState<string>(NO_ROLE);
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address");
      return;
    }
    const days = Number(expiresInDays);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      setError("Expires in must be between 1 and 365 days");
      return;
    }

    start(async () => {
      const res = await createInvitation({
        email: trimmedEmail || undefined,
        roleName: roleName === NO_ROLE ? undefined : roleName,
        expiresInDays: days,
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if (res.ok && res.token) {
        const link = `${baseUrl}/invite/${res.token}`;
        setLastLink(link);
        await navigator.clipboard.writeText(link).catch(() => {});
        setSuccess("Invite created — link copied to clipboard.");
        setEmail("");
      }
    });
  }

  function copy() {
    if (!lastLink) return;
    navigator.clipboard.writeText(lastLink).catch(() => {});
    setSuccess("Copied.");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="invite-email">Email (optional)</Label>
          <Input
            id="invite-email"
            type="text"
            placeholder="anyone with link"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-expiry">Expires in (days)</Label>
          <Input
            id="invite-expiry"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-role">Role</Label>
          <Select value={roleName} onValueChange={setRoleName}>
            <SelectTrigger id="invite-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ROLE}>None</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

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
          <Button type="button" variant="ghost" size="icon" onClick={copy}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Plus className="mr-2 h-4 w-4" />
          {pending ? "Creating…" : "Create invite link"}
        </Button>
      </div>
    </form>
  );
}
