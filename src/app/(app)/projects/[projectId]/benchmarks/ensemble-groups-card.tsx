"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Save,
  Plus,
  Trash2,
  RefreshCw,
  Layers,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/components/confirm-dialog";
import {
  createEnsembleGroup,
  updateEnsembleGroup,
  deleteEnsembleGroup,
} from "./actions";

interface ProviderOption {
  id: string;
  name: string;
  kind: string;
  defaultModel: string | null;
}
interface Judge {
  providerCredentialId: string;
  model: string;
}
interface Group {
  id: string;
  name: string;
  description: string | null;
  judges: Judge[];
}

// Multi-group ensemble manager. Each group is a named bundle of
// {provider, model} judges (e.g. "Strict trio", "Cheap pair"). The
// project can have many; each benchmark picks one as its default for
// the "Re-judge with ensemble" flow.
//
// State lives entirely on the client until the user clicks Save on a
// group — at which point we round-trip through the server action and
// router.refresh() to pull the new persisted shape back.
export function EnsembleGroupsCard({
  projectId,
  providers,
  initialGroups,
  disabled,
}: {
  projectId: string;
  providers: ProviderOption[];
  initialGroups: Group[];
  disabled: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  // editingId is the id of the group currently open in edit mode, or
  // "__new__" while creating a new group, or null while idle.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftJudges, setDraftJudges] = useState<Judge[]>([]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setError(null);
    setEditingId("__new__");
    setDraftName("");
    setDraftDescription("");
    setDraftJudges([
      { providerCredentialId: providers[0]?.id ?? "", model: providers[0]?.defaultModel ?? "" },
      { providerCredentialId: providers[0]?.id ?? "", model: "" },
    ]);
  }

  function openEdit(g: Group) {
    setError(null);
    setEditingId(g.id);
    setDraftName(g.name);
    setDraftDescription(g.description ?? "");
    setDraftJudges(
      g.judges.length > 0
        ? g.judges.map((j) => ({ ...j }))
        : [{ providerCredentialId: providers[0]?.id ?? "", model: "" }],
    );
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  function addJudge() {
    setDraftJudges((prev) => [
      ...prev,
      { providerCredentialId: providers[0]?.id ?? "", model: "" },
    ]);
  }
  function removeJudge(i: number) {
    setDraftJudges((prev) => prev.filter((_, idx) => idx !== i));
  }
  function setJudge(i: number, patch: Partial<Judge>) {
    setDraftJudges((prev) =>
      prev.map((j, idx) => (idx === i ? { ...j, ...patch } : j)),
    );
  }

  function save() {
    setError(null);
    if (!draftName.trim()) {
      setError("Name required");
      return;
    }
    const clean = draftJudges.filter(
      (j) => j.providerCredentialId && j.model.trim(),
    );
    start(async () => {
      const res =
        editingId === "__new__"
          ? await createEnsembleGroup({
              projectId,
              name: draftName.trim(),
              description: draftDescription.trim() || null,
              judges: clean.map((j) => ({
                providerCredentialId: j.providerCredentialId,
                model: j.model.trim(),
              })),
            })
          : await updateEnsembleGroup({
              projectId,
              groupId: editingId!,
              name: draftName.trim(),
              description: draftDescription.trim() || null,
              judges: clean.map((j) => ({
                providerCredentialId: j.providerCredentialId,
                model: j.model.trim(),
              })),
            });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  async function onDelete(g: Group) {
    setError(null);
    const ok = await confirm({
      title: `Delete ensemble group "${g.name}"?`,
      body: "Benchmarks that pointed to this group as their default will revert to no default. Existing run results that already used this group are unaffected.",
      confirmText: "Delete group",
      cancelText: "Keep",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await deleteEnsembleGroup({ projectId, groupId: g.id });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4" />
          Ensemble judge groups
        </CardTitle>
        <CardDescription>
          Named bundles of judges (e.g. <em>Strict trio</em>, <em>Cheap pair</em>).
          Each benchmark picks one as its default for the &quot;Re-judge with
          ensemble&quot; flow; runs can override at re-judge time. Need ≥2
          judges per group for meaningful consensus.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {initialGroups.length === 0 && editingId !== "__new__" && (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No ensemble groups yet. Click <strong>New group</strong> to make one.
          </div>
        )}

        {/* Existing groups (read-only rows + Edit/Delete) */}
        {initialGroups.map((g) =>
          editingId === g.id ? (
            <GroupEditor
              key={g.id}
              providers={providers}
              name={draftName}
              description={draftDescription}
              judges={draftJudges}
              pending={pending}
              error={error}
              onNameChange={setDraftName}
              onDescriptionChange={setDraftDescription}
              onAddJudge={addJudge}
              onRemoveJudge={removeJudge}
              onSetJudge={setJudge}
              onSave={save}
              onCancel={cancelEdit}
            />
          ) : (
            <div
              key={g.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {g.judges.length} judge{g.judges.length === 1 ? "" : "s"}
                  </Badge>
                  {g.judges.length < 2 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400"
                      title="Ensemble re-judge needs ≥2 judges."
                    >
                      needs ≥2
                    </Badge>
                  )}
                </div>
                {g.description && (
                  <div className="mb-1 text-[11px] text-muted-foreground">
                    {g.description}
                  </div>
                )}
                <ul className="space-y-0.5 font-mono text-[11px]">
                  {g.judges.map((j, i) => {
                    const p = providers.find((x) => x.id === j.providerCredentialId);
                    return (
                      <li key={i} className="flex items-center gap-2">
                        <span>{j.model}</span>
                        <span className="text-muted-foreground">
                          via {p?.name ?? "(unknown)"}{" "}
                          {p && <span className="text-muted-foreground/70">({p.kind})</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(g)}
                  disabled={disabled || pending}
                  title="Edit group"
                  className="h-8 w-8 p-0"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(g)}
                  disabled={disabled || pending}
                  title="Delete group"
                  className="h-8 w-8 p-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ),
        )}

        {/* New group editor when active */}
        {editingId === "__new__" && (
          <GroupEditor
            providers={providers}
            name={draftName}
            description={draftDescription}
            judges={draftJudges}
            pending={pending}
            error={error}
            onNameChange={setDraftName}
            onDescriptionChange={setDraftDescription}
            onAddJudge={addJudge}
            onRemoveJudge={removeJudge}
            onSetJudge={setJudge}
            onSave={save}
            onCancel={cancelEdit}
          />
        )}

        {editingId === null && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openCreate}
            disabled={disabled}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            New group
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// Inline editor used both for new groups and for editing existing ones.
// State is owned by the parent; this component is presentational so we
// can share it across both paths without prop drift.
function GroupEditor({
  providers,
  name,
  description,
  judges,
  pending,
  error,
  onNameChange,
  onDescriptionChange,
  onAddJudge,
  onRemoveJudge,
  onSetJudge,
  onSave,
  onCancel,
}: {
  providers: ProviderOption[];
  name: string;
  description: string;
  judges: Judge[];
  pending: boolean;
  error: string | null;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onAddJudge: () => void;
  onRemoveJudge: (i: number) => void;
  onSetJudge: (i: number, patch: Partial<Judge>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="eg-name">Name</Label>
          <Input
            id="eg-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. Strict trio"
            disabled={pending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="eg-desc">Description (optional)</Label>
          <Input
            id="eg-desc"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="When to use this group"
            disabled={pending}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Judges</Label>
        {judges.map((j, i) => (
          <div
            key={i}
            className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_auto]"
          >
            <Select
              value={j.providerCredentialId}
              onValueChange={(v) => {
                const p = providers.find((x) => x.id === v);
                onSetJudge(i, {
                  providerCredentialId: v,
                  ...(p?.defaultModel && !j.model ? { model: p.defaultModel } : {}),
                });
              }}
              disabled={pending}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}{" "}
                    <span className="ml-1 text-muted-foreground">({p.kind})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={j.model}
              onChange={(e) => onSetJudge(i, { model: e.target.value })}
              placeholder="model name (e.g. claude-opus-4-7)"
              disabled={pending}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onRemoveJudge(i)}
              disabled={pending || judges.length <= 1}
              title="Remove this judge"
              className="h-9 w-9 p-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddJudge}
          disabled={pending || judges.length >= 8}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add judge
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={pending}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={pending}>
          {pending ? (
            <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-2 h-3.5 w-3.5" />
          )}
          {pending ? "Saving…" : "Save group"}
        </Button>
      </div>
    </div>
  );
}
