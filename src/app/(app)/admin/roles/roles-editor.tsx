"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { setRolePermissions, createRole, deleteRole } from "./actions";

interface Role {
  id: string;
  name: string;
  permissions: string[];
}

interface PermissionDef {
  key: string;
  description: string | null;
}

export function RolesEditor({
  roles,
  allPermissions,
}: {
  roles: Role[];
  allPermissions: PermissionDef[];
}) {
  const [pending, start] = useTransition();
  const [newRole, setNewRole] = useState("");

  function togglePerm(role: Role, key: string, checked: boolean) {
    const next = checked
      ? [...role.permissions, key]
      : role.permissions.filter((p) => p !== key);
    start(async () => {
      try {
        await setRolePermissions(role.id, next);
        toast.success(`Updated ${role.name}`);
      } catch {
        toast.error("Failed to update permissions");
      }
    });
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newRole.trim()) return;
    start(async () => {
      try {
        await createRole(newRole.trim());
        setNewRole("");
        toast.success("Role created");
      } catch {
        toast.error("Failed to create role");
      }
    });
  }

  function onDelete(role: Role) {
    if (!confirm(`Delete role "${role.name}"?`)) return;
    start(async () => {
      try {
        await deleteRole(role.id);
        toast.success("Role deleted");
      } catch {
        toast.error("Failed to delete role");
      }
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onCreate} className="flex gap-2">
        <Input
          value={newRole}
          onChange={(e) => setNewRole(e.target.value)}
          placeholder="New role name"
          className="max-w-xs"
        />
        <Button type="submit" disabled={pending || !newRole.trim()}>
          <Plus className="mr-2 h-4 w-4" /> Add role
        </Button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Role</th>
              {allPermissions.map((p) => (
                <th key={p.key} className="px-2 py-2 font-medium" title={p.description ?? ""}>
                  {p.key}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id} className="border-b border-border/50">
                <td className="py-3 pr-4 font-medium">{role.name}</td>
                {allPermissions.map((p) => (
                  <td key={p.key} className="px-2 py-3">
                    <Checkbox
                      checked={role.permissions.includes(p.key)}
                      disabled={pending}
                      onCheckedChange={(v) => togglePerm(role, p.key, v === true)}
                    />
                  </td>
                ))}
                <td className="py-3 pl-4 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pending}
                    onClick={() => onDelete(role)}
                    aria-label="Delete role"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
