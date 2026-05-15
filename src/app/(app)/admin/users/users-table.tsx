"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";
import { setUserRoles, deleteUser } from "./actions";

interface User {
  id: string;
  email: string;
  name: string | null;
  roles: string[];
}

const NONE = "__none__";

export function UsersTable({ users, allRoles }: { users: User[]; allRoles: string[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
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

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">User</th>
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="py-2 pl-4" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const current = u.roles[0] ?? NONE;
              return (
                <tr key={u.id} className="border-b border-border/50">
                  <td className="py-3 pr-4">
                    <div className="font-medium">{u.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="py-3 pr-4">
                    <Select
                      value={current}
                      onValueChange={(v) => changeRole(u, v)}
                      disabled={pending}
                    >
                      <SelectTrigger size="sm" className="w-48">
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
                  </td>
                  <td className="py-3 pl-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      onClick={() => onDelete(u)}
                      aria-label="Delete user"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
