"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
      "description": "Customer's bank account number (locale-specific format)"
    }
  },
  "required": ["account_number"]
}`;

export function ToolForm({
  projectId,
  catalogId,
  providers,
  taxonomyNodes,
  existingTools,
}: {
  projectId: string;
  catalogId: string;
  providers: Provider[];
  taxonomyNodes?: string[];
  existingTools?: string[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parametersJson, setParametersJson] = useState(STARTER_PARAMS);
  const [presets, setPresets] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const suggestOpen = searchParams.get("suggest") === "1";
  const setSuggestOpen = useCallback(
    (next: boolean) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (next) params.set("suggest", "1");
      else params.delete("suggest");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

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
    setError(null);
    setSuccess(null);
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
      if ("error" in res && res.error) {
        setError(res.error);
      } else if (res.ok) {
        setSuccess(`Tool “${name}” created.`);
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
          placeholder='A function that looks up a customer bank-account balance by account number. Returns the current balance and last 5 transactions. Tag with "banking" plus a country tag (e.g. "maybank", "barclays", "bnpparibas").'
          onApply={applyAi}
          open={suggestOpen}
          onOpenChange={setSuggestOpen}
          randomizePrompt={{
            description:
              "Invent ONE concise prompt for an LLM to draft a ToolDef. Pick a realistic domain (Malaysian retail banking, telco postpaid, healthcare appointment, government e-filing, e-commerce returns, ride-hailing, food delivery, etc.) and describe a specific function the customer-support assistant could call (lookup, status check, update, mock action). Mention 2–4 concrete arguments by name (with locale-appropriate formats like MyKad / IBAN / SIRET / tracking ID) and one or two locale presets to tag it with. ONE or TWO sentences — used as input to a downstream form-filling LLM.",
            context: [
              taxonomyNodes && taxonomyNodes.length > 0
                ? `Project taxonomy topics (pick one when relevant):\n${taxonomyNodes.map((t) => `- ${t}`).join("\n")}`
                : null,
              existingTools && existingTools.length > 0
                ? `Existing tools in this catalog (avoid duplicates; pick a complementary function):\n${existingTools.map((t) => `- ${t}`).join("\n")}`
                : null,
            ]
              .filter(Boolean)
              .join("\n\n") || null,
          }}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
        <div className="space-y-2">
          <Label htmlFor="t-name">Name</Label>
          <Input
            id="t-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="bank_account_balance"
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
            placeholder="banking, telco, …"
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
          placeholder="Look up the current account balance and recent transactions for a customer bank account."
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

      <div className="space-y-2">
        <Button type="submit" disabled={pending}>
          <Plus className="mr-2 h-4 w-4" />
          {pending ? "Creating…" : "Create tool"}
        </Button>
        {error && (
          <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {success && <p className="text-xs text-green-600">{success}</p>}
      </div>
    </form>
  );
}
