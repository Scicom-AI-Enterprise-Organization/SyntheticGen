"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { revokeInvitation } from "./actions";

interface Invite {
  id: string;
  token: string;
  email: string | null;
  roleName: string | null;
  invitedBy: string | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function statusOf(i: Invite): { label: string; tone: "secondary" | "outline" | "default" } {
  if (i.acceptedAt) return { label: "Accepted", tone: "secondary" };
  if (i.revokedAt) return { label: "Revoked", tone: "outline" };
  if (i.expiresAt && new Date(i.expiresAt) < new Date()) return { label: "Expired", tone: "outline" };
  return { label: "Active", tone: "default" };
}

export function InvitationsTable({
  invitations,
  baseUrl,
}: {
  invitations: Invite[];
  baseUrl: string;
}) {
  const [pending, start] = useTransition();

  function copy(token: string) {
    navigator.clipboard.writeText(`${baseUrl}/invite/${token}`);
    toast.success("Link copied");
  }

  function onRevoke(i: Invite) {
    if (!confirm("Revoke this invitation?")) return;
    start(async () => {
      try {
        await revokeInvitation(i.id);
        toast.success("Revoked");
      } catch {
        toast.error("Failed to revoke");
      }
    });
  }

  if (invitations.length === 0) {
    return <p className="text-sm text-muted-foreground">No invitations yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Email</th>
            <th className="py-2 pr-4 font-medium">Role</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Invited by</th>
            <th className="py-2 pr-4 font-medium">Expires</th>
            <th className="py-2 pl-4" />
          </tr>
        </thead>
        <tbody>
          {invitations.map((i) => {
            const s = statusOf(i);
            const active = s.label === "Active";
            return (
              <tr key={i.id} className="border-b border-border/50">
                <td className="py-3 pr-4">{i.email ?? <span className="text-muted-foreground">— anyone with link</span>}</td>
                <td className="py-3 pr-4">{i.roleName ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="py-3 pr-4">
                  <Badge variant={s.tone}>{s.label}</Badge>
                  {i.acceptedBy && (
                    <span className="ml-2 text-xs text-muted-foreground">by {i.acceptedBy}</span>
                  )}
                </td>
                <td className="py-3 pr-4 text-muted-foreground">{i.invitedBy ?? "—"}</td>
                <td className="py-3 pr-4 text-muted-foreground">
                  {i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : "—"}
                </td>
                <td className="py-3 pl-4 text-right">
                  {active && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copy(i.token)}
                        aria-label="Copy invite link"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={pending}
                        onClick={() => onRevoke(i)}
                        aria-label="Revoke invite"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
