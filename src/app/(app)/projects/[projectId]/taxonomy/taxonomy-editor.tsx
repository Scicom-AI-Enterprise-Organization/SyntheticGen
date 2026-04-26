"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiAssistButton } from "@/components/ai-assist-button";
import { createTaxonomyNode, deleteTaxonomyNode } from "./actions";

interface Node {
  id: string;
  name: string;
  slug: string;
  path: string;
}

interface Provider {
  id: string;
  name: string;
  defaultModel: string | null;
}

export function TaxonomyEditor({
  projectId,
  taxonomyId,
  canWrite,
  providers,
  nodes,
}: {
  projectId: string;
  taxonomyId: string;
  canWrite: boolean;
  providers: Provider[];
  nodes: Node[];
}) {
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    start(async () => {
      const res = await createTaxonomyNode({ projectId, taxonomyId, name });
      if ("error" in res && res.error) toast.error(res.error);
      else {
        setName("");
        toast.success("Node added");
      }
    });
  }

  function remove(n: Node) {
    if (!confirm(`Delete node "${n.name}"?`)) return;
    start(async () => {
      const res = await deleteTaxonomyNode(projectId, n.id);
      if ("error" in res && (res as { error?: string }).error)
        toast.error((res as { error: string }).error);
      else toast.success("Node deleted");
    });
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <>
          <form onSubmit={add} className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. billing, modem-troubleshooting, plan-upgrade"
              disabled={pending}
            />
            <Button type="submit" disabled={pending}>
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
            <AiAssistButton
              projectId={projectId}
              kind="taxonomy-node"
              providers={providers}
              placeholder="A taxonomy node for postpaid plan upgrade conversations."
              onApply={(data) => {
                if (typeof data["name"] === "string") setName(data["name"] as string);
              }}
              buttonLabel="Suggest"
            />
          </form>
        </>
      )}

      {nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No nodes yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {nodes.map((n) => (
            <li key={n.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{n.name}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{n.path}</span>
              </div>
              {canWrite && (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  onClick={() => remove(n)}
                  aria-label="Delete node"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
