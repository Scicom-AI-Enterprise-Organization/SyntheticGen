"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronUp, Plus, X, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface ToolOption {
  id: string;
  name: string;
  description?: string | null;
  localePresets?: string[];
}

interface Props {
  available: ToolOption[];
  selected: string[];
  mode: "sequential" | "parallel";
  disabled?: boolean;
  onChange: (selected: string[]) => void;
  onModeChange: (mode: "sequential" | "parallel") => void;
}

const ADD_PLACEHOLDER = "__add__";

export function ToolListPicker({
  available,
  selected,
  mode,
  disabled,
  onChange,
  onModeChange,
}: Props) {
  const byId = useMemo(() => new Map(available.map((t) => [t.id, t])), [available]);
  const remaining = available.filter((t) => !selected.includes(t.id));

  function append(id: string) {
    if (id === ADD_PLACEHOLDER || !id) return;
    if (selected.includes(id)) return;
    onChange([...selected, id]);
  }

  function remove(id: string) {
    onChange(selected.filter((x) => x !== id));
  }

  function move(id: string, dir: -1 | 1) {
    const i = selected.indexOf(id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Tools called at this turn</Label>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>mode:</span>
          <Select
            value={mode}
            onValueChange={(v) => onModeChange(v as "sequential" | "parallel")}
            disabled={disabled}
          >
            <SelectTrigger className="h-7 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sequential">sequential →</SelectItem>
              <SelectItem value="parallel">parallel ∥</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selected.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground">
          No tools — the assistant will produce a plain text reply.
        </p>
      ) : (
        <ol className="space-y-1">
          {selected.map((id, idx) => {
            const t = byId.get(id);
            const missing = !t;
            return (
              <li
                key={id}
                className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs"
              >
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-medium"
                  aria-hidden
                >
                  {idx + 1}
                </span>
                <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className={missing ? "min-w-0 flex-1 truncate text-destructive" : "min-w-0 flex-1 truncate font-mono"}>
                  {missing ? `${id} (deleted)` : t.name}
                </span>
                {!disabled && (
                  <>
                    {mode === "sequential" && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label="Move up"
                          disabled={idx === 0}
                          onClick={() => move(id, -1)}
                        >
                          <ChevronUp className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          aria-label="Move down"
                          disabled={idx === selected.length - 1}
                          onClick={() => move(id, 1)}
                        >
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label="Remove"
                      onClick={() => remove(id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {!disabled && remaining.length > 0 && (
        <Select value={ADD_PLACEHOLDER} onValueChange={append} disabled={disabled}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="+ Add tool…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ADD_PLACEHOLDER} disabled>
              + Add tool…
            </SelectItem>
            {remaining.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className="font-mono text-xs">{t.name}</span>
                {t.localePresets && t.localePresets.length > 0 && (
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    {t.localePresets.slice(0, 3).join(", ")}
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {!disabled && remaining.length === 0 && available.length > 0 && (
        <p className="text-[10px] text-muted-foreground">All catalog tools added.</p>
      )}

      {available.length === 0 && (
        <p className="text-[10px] text-muted-foreground">
          No tools defined yet. Add some on the Tools tab to use them here.
        </p>
      )}

      {selected.length > 1 && (
        <p className="text-[10px] text-muted-foreground">
          {mode === "sequential" ? (
            <>Sequential: each call sees the results of earlier calls before the assistant replies.</>
          ) : (
            <>Parallel: the model fans out all calls in one shot; results all return before the reply.</>
          )}
        </p>
      )}
    </div>
  );
}
