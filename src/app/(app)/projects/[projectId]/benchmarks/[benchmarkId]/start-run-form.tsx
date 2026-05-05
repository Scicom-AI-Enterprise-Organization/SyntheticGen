"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play } from "lucide-react";
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
import { startBenchmarkRun } from "../actions";

interface ProviderOption {
  id: string;
  name: string;
  kind: string;
  defaultModel: string | null;
}

export function StartRunForm({
  projectId,
  benchmarkId,
  providers,
}: {
  projectId: string;
  benchmarkId: string;
  providers: ProviderOption[];
}) {
  const router = useRouter();
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [model, setModel] = useState(providers[0]?.defaultModel ?? "");
  const [pending, start] = useTransition();

  function onProviderChange(v: string) {
    setProviderId(v);
    const p = providers.find((x) => x.id === v);
    if (p?.defaultModel) setModel(p.defaultModel);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!model.trim()) {
      toast.error("Model required");
      return;
    }
    start(async () => {
      const res = await startBenchmarkRun({
        projectId,
        benchmarkId,
        providerCredentialId: providerId,
        model: model.trim(),
      });
      if ("error" in res && res.error) toast.error(res.error);
      else if (res.ok) {
        toast.success("Benchmark run started");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <div className="space-y-2">
        <Label htmlFor="b-provider">Provider</Label>
        <Select value={providerId} onValueChange={onProviderChange}>
          <SelectTrigger id="b-provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name} <span className="ml-1 text-muted-foreground">({p.kind})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="b-model">Model</Label>
        <Input
          id="b-model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="e.g. gpt-4o-mini, qwen/qwen2.5-72b-instruct"
          required
        />
      </div>
      <div className="self-end">
        <Button type="submit" disabled={pending}>
          <Play className="mr-2 h-4 w-4" />
          {pending ? "Starting…" : "Start run"}
        </Button>
      </div>
    </form>
  );
}
