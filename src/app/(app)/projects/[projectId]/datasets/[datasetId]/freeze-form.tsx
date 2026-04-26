"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Snowflake } from "lucide-react";
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
import { freezeDatasetVersion } from "../actions";

const ALL = "__all__";

export function FreezeForm({
  projectId,
  datasetId,
  runs,
}: {
  projectId: string;
  datasetId: string;
  runs: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [version, setVersion] = useState("0.1.0");
  const [description, setDescription] = useState("");
  const [filterRunId, setFilterRunId] = useState(ALL);
  const [filterStatus, setFilterStatus] = useState<"accepted" | "any">("accepted");
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await freezeDatasetVersion({
        projectId,
        datasetId,
        version,
        description: description || null,
        filterRunId: filterRunId === ALL ? null : filterRunId,
        filterStatus,
      });
      if ("error" in res && res.error) toast.error(res.error);
      else if (res.ok) {
        toast.success("Version frozen");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <div className="space-y-2">
          <Label>Version</Label>
          <Input value={version} onChange={(e) => setVersion(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Run filter</Label>
          <Select value={filterRunId} onValueChange={setFilterRunId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All accepted conversations</SelectItem>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as "accepted" | "any")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="accepted">accepted only</SelectItem>
              <SelectItem value="any">any status</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        <Snowflake className="mr-2 h-4 w-4" />
        {pending ? "Freezing…" : "Freeze version"}
      </Button>
    </form>
  );
}
