"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createBenchmark } from "./actions";

// Curated quick-presets so users can land a working benchmark with one click.
const PRESETS = [
  {
    name: "Scicom Function-Call (en/zh/ms)",
    source: "hf:Scicom-intl/Function-Call",
    splits: "english,mandarin,malay",
    description:
      "Telco multi-function multi-turn function-calling benchmark across three language splits.",
  },
];

export function CreateBenchmarkForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState("hf:Scicom-intl/Function-Call");
  const [splits, setSplits] = useState("english,mandarin,malay");
  const [maxRows, setMaxRows] = useState("");
  const [pending, start] = useTransition();

  function applyPreset(p: (typeof PRESETS)[number]) {
    setName((cur) => cur || p.name);
    setDescription((cur) => cur || p.description);
    setSource(p.source);
    setSplits(p.splits);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedMax = maxRows.trim() === "" ? null : Number(maxRows);
    if (parsedMax != null && (!Number.isFinite(parsedMax) || parsedMax < 1)) {
      toast.error("Max rows must be a positive integer or empty");
      return;
    }
    const splitList = splits
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (splitList.length === 0) {
      toast.error("Pick at least one split");
      return;
    }
    start(async () => {
      const res = await createBenchmark({
        projectId,
        name,
        description: description || null,
        source: source.trim(),
        splits: splitList,
        maxRowsPerSplit: parsedMax,
        config: { kind: "function-call" },
      });
      if ("error" in res && res.error) toast.error(res.error);
      else if (res.ok) {
        toast.success("Benchmark created");
        router.push(`/projects/${projectId}/benchmarks/${res.id}`);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground">Quick presets:</span>
        {PRESETS.map((p) => (
          <Button
            key={p.source}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => applyPreset(p)}
          >
            {p.name}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="b-name">Name</Label>
          <Input
            id="b-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Function-Call benchmark"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="b-source">Source</Label>
          <Input
            id="b-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="hf:Scicom-intl/Function-Call"
            required
          />
          <p className="text-[10px] text-muted-foreground">
            <code>hf:&lt;org&gt;/&lt;dataset&gt;</code> from HuggingFace.
          </p>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="b-desc">Description</Label>
          <Input
            id="b-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this benchmark measures"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="b-splits">Splits</Label>
          <Input
            id="b-splits"
            value={splits}
            onChange={(e) => setSplits(e.target.value)}
            placeholder="english,mandarin,malay"
            required
          />
          <p className="text-[10px] text-muted-foreground">
            Comma-separated. Each becomes a <code>load_dataset(name, config=split)</code> call.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="b-max">Max rows per split (optional)</Label>
          <Input
            id="b-max"
            type="number"
            min={1}
            max={10000}
            value={maxRows}
            onChange={(e) => setMaxRows(e.target.value)}
            placeholder="e.g. 50 for a smoke run"
          />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        <Plus className="mr-2 h-4 w-4" />
        {pending ? "Creating…" : "Create benchmark"}
      </Button>
    </form>
  );
}
