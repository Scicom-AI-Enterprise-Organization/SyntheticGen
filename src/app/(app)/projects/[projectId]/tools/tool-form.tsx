"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AiAssistButton } from "@/components/ai-assist-button";
import { createToolDef } from "./actions";

interface Provider {
  id: string;
  name: string;
  defaultModel: string | null;
}

const STARTER_PARAMS = `{
  "type": "object",
  "properties": {
    "account_number": {
      "type": "string",
      "description": "12-digit Maybank account number"
    }
  },
  "required": ["account_number"]
}`;

export function ToolForm({
  projectId,
  catalogId,
  providers,
}: {
  projectId: string;
  catalogId: string;
  providers: Provider[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parametersJson, setParametersJson] = useState(STARTER_PARAMS);
  const [presets, setPresets] = useState("");
  const [pending, start] = useTransition();

  function applyAi(data: Record<string, unknown>) {
    const s = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null);
    if (s("name")) setName(s("name")!);
    if (s("description")) setDescription(s("description")!);
    if (data["parameters"] && typeof data["parameters"] === "object") {
      setParametersJson(JSON.stringify(data["parameters"], null, 2));
    } else if (s("parametersJson")) {
      // Some models return the JSON Schema as a string under this key.
      setParametersJson(s("parametersJson")!);
    }
    if (Array.isArray(data["localePresets"])) {
      setPresets(
        (data["localePresets"] as unknown[])
          .filter((x): x is string => typeof x === "string")
          .join(", "),
      );
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createToolDef({
        projectId,
        catalogId,
        name,
        description,
        parametersJson,
        localePresets: presets
          .split(/[,\n]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      if ("error" in res && res.error) toast.error(res.error);
      else if (res.ok) {
        toast.success("Tool created");
        setName("");
        setDescription("");
        setParametersJson(STARTER_PARAMS);
        setPresets("");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex justify-end">
        <AiAssistButton
          projectId={projectId}
          kind="tool-def"
          providers={providers}
          placeholder='A function that looks up a Maybank account balance by 12-digit account number. Returns balance in MYR and the last 5 transactions. Tag with "maybank".'
          onApply={applyAi}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
        <div className="space-y-2">
          <Label htmlFor="t-name">Name</Label>
          <Input
            id="t-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="maybank_account_balance"
            pattern="^[a-zA-Z_][a-zA-Z0-9_]*$"
            title="snake_case identifier"
            required
          />
          <p className="text-[11px] text-muted-foreground">
            Snake_case identifier — passed to the model as the function name.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="t-presets">Locale presets</Label>
          <Input
            id="t-presets"
            value={presets}
            onChange={(e) => setPresets(e.target.value)}
            placeholder="maybank, banking"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="t-desc">Description</Label>
        <Textarea
          id="t-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Look up the current account balance and recent transactions for a Maybank account."
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="t-params">Parameters (JSON Schema)</Label>
        <Textarea
          id="t-params"
          value={parametersJson}
          onChange={(e) => setParametersJson(e.target.value)}
          rows={10}
          className="font-mono text-xs"
          required
        />
        <p className="text-[11px] text-muted-foreground">
          Standard OpenAI function-calling parameter shape. Must be a JSON object.
        </p>
      </div>

      <Button type="submit" disabled={pending}>
        <Plus className="mr-2 h-4 w-4" />
        {pending ? "Creating…" : "Create tool"}
      </Button>
    </form>
  );
}
