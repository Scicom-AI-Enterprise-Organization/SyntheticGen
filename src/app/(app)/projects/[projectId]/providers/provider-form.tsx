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
import { createProvider } from "./actions";

type ProviderKind = "openai" | "vllm" | "together" | "openrouter" | "sglang" | "anthropic-proxy" | "custom";

const KIND_DEFAULTS: Record<ProviderKind, { baseUrl: string; defaultModel: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  vllm: { baseUrl: "http://localhost:8001/v1", defaultModel: "" },
  together: { baseUrl: "https://api.together.xyz/v1", defaultModel: "" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", defaultModel: "" },
  sglang: { baseUrl: "http://localhost:30000/v1", defaultModel: "" },
  "anthropic-proxy": { baseUrl: "", defaultModel: "" },
  custom: { baseUrl: "", defaultModel: "" },
};

export function ProviderForm({ projectId }: { projectId: string }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProviderKind>("openai");
  const [baseUrl, setBaseUrl] = useState(KIND_DEFAULTS["openai"].baseUrl);
  const [defaultModel, setDefaultModel] = useState(KIND_DEFAULTS["openai"].defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [pending, start] = useTransition();

  function onKindChange(v: string) {
    const k = v as ProviderKind;
    setKind(k);
    const d = KIND_DEFAULTS[k];
    if (d) {
      setBaseUrl(d.baseUrl);
      setDefaultModel(d.defaultModel);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createProvider({
        projectId,
        name,
        kind,
        baseUrl,
        apiKey,
        defaultModel: defaultModel || null,
      });
      if ("error" in res && res.error) toast.error(res.error);
      else {
        toast.success("Provider added");
        setName("");
        setApiKey("");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pv-name">Name</Label>
          <Input
            id="pv-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production OpenAI"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pv-kind">Kind</Label>
          <Select value={kind} onValueChange={onKindChange as (v: string) => void}>
            <SelectTrigger id="pv-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="vllm">vLLM (self-hosted)</SelectItem>
              <SelectItem value="together">Together</SelectItem>
              <SelectItem value="openrouter">OpenRouter</SelectItem>
              <SelectItem value="sglang">SGLang</SelectItem>
              <SelectItem value="anthropic-proxy">Anthropic (via OpenAI-compat proxy)</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="pv-url">Base URL</Label>
          <Input
            id="pv-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            required
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="pv-key">API key</Label>
          <Input
            id="pv-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            Encrypted with AES-256-GCM before storage. Decrypted only inside the Python worker.
          </p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="pv-model">Default model (optional)</Label>
          <Input
            id="pv-model"
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="gpt-4o-mini"
          />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        <Plus className="mr-2 h-4 w-4" />
        {pending ? "Adding…" : "Add provider"}
      </Button>
    </form>
  );
}
