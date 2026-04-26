"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
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
import { addProjectMember } from "../../actions";

export function AddMemberForm({ projectId }: { projectId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"OWNER" | "EDITOR" | "ANNOTATOR" | "VIEWER">("EDITOR");
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await addProjectMember({ projectId, email, role });
      if ("error" in res && res.error) toast.error(res.error);
      else {
        toast.success("Member added");
        setEmail("");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
      <div className="space-y-2">
        <Label htmlFor="member-email" className="sr-only">
          Email
        </Label>
        <Input
          id="member-email"
          type="email"
          placeholder="user@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="member-role" className="sr-only">
          Role
        </Label>
        <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
          <SelectTrigger id="member-role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OWNER">Owner</SelectItem>
            <SelectItem value="EDITOR">Editor</SelectItem>
            <SelectItem value="ANNOTATOR">Annotator</SelectItem>
            <SelectItem value="VIEWER">Viewer</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={pending}>
        <Plus className="mr-2 h-4 w-4" />
        {pending ? "Adding…" : "Add"}
      </Button>
    </form>
  );
}
