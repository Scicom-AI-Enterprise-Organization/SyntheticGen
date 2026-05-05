"use client";

import { useTransition } from "react";
import { toast } from "sonner";
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
import { addProjectMember, removeProjectMember } from "../../actions";

interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: "OWNER" | "EDITOR" | "ANNOTATOR" | "VIEWER";
}

export function MembersTable({
  projectId,
  canManage,
  members,
}: {
  projectId: string;
  canManage: boolean;
  members: Member[];
}) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();

  function changeRole(m: Member, role: Member["role"]) {
    start(async () => {
      const res = await addProjectMember({ projectId, email: m.email, role });
      if ("error" in res && res.error) toast.error(res.error);
      else toast.success("Role updated");
    });
  }

  async function remove(m: Member) {
    const ok = await confirm({
      title: `Remove ${m.email}?`,
      body: "They lose access to this project. Their account is unaffected.",
      confirmText: "Remove",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await removeProjectMember(projectId, m.userId);
      if ("error" in res && (res as { error?: string }).error)
        toast.error((res as { error: string }).error);
      else toast.success("Member removed");
    });
  }

  return (
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
          {members.map((m) => (
            <tr key={m.userId} className="border-b border-border/50">
              <td className="py-3 pr-4">
                <div className="font-medium">{m.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{m.email}</div>
              </td>
              <td className="py-3 pr-4">
                {canManage ? (
                  <Select
                    value={m.role}
                    onValueChange={(v) => changeRole(m, v as Member["role"])}
                    disabled={pending}
                  >
                    <SelectTrigger className="w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OWNER">Owner</SelectItem>
                      <SelectItem value="EDITOR">Editor</SelectItem>
                      <SelectItem value="ANNOTATOR">Annotator</SelectItem>
                      <SelectItem value="VIEWER">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                    {m.role}
                  </span>
                )}
              </td>
              <td className="py-3 pl-4 text-right">
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    onClick={() => remove(m)}
                    aria-label="Remove member"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
