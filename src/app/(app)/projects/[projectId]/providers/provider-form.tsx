"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Check, Loader2, Trash2 } from "lucide-react";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createProvider, testProviderConnection, updateProvider } from "./actions";

type ProviderKind = "openai" | "vllm" | "together" | "openrouter" | "sglang" | "anthropic-proxy" | "custom";
type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface ExistingProvider {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  defaultModel: string | null;
  reasoningEffort: string | null;
  chatTemplateKwargs: Record<string, unknown> | null;
  keyFingerprint: string;
}

interface KwargRow {
  id: string;
  key: string;
  // Raw text the user typed. We try `JSON.parse` on submit; if that fails we
  // fall back to the literal string. So `true`, `false`, `42`, `"hello"`, and
  // `["a","b"]` all do the right thing.
  raw: string;
}

function buildKwargs(rows: KwargRow[]): { value: Record<string, unknown>; error: string | null } {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (!k) continue;
    const raw = r.raw.trim();
    if (raw === "") {
      return { value: {}, error: `Value for "${k}" is empty` };
    }
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch {
      v = raw;
    }
    out[k] = v;
  }
  return { value: out, error: null };
}

function newRow(key = "", raw = ""): KwargRow {
  return { id: Math.random().toString(36).slice(2), key, raw };
}

const KIND_DEFAULTS: Record<ProviderKind, { baseUrl: string; defaultModel: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  vllm: { baseUrl: "http://localhost:8001/v1", defaultModel: "" },
  together: { baseUrl: "https://api.together.xyz/v1", defaultModel: "" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", defaultModel: "" },
  sglang: { baseUrl: "http://localhost:30000/v1", defaultModel: "" },
  "anthropic-proxy": { baseUrl: "", defaultModel: "" },
  custom: { baseUrl: "", defaultModel: "" },
};

export function ProviderForm({
  projectId,
  existing,
  onSaved,
  card,
}: {
  projectId: string;
  existing?: ExistingProvider;
  onSaved?: () => void;
  card?: { title: string; description?: string };
}) {
  const isEdit = Boolean(existing);
  const [name, setName] = useState(existing?.name ?? "");
  const [kind, setKind] = useState<ProviderKind>(
    (existing?.kind as ProviderKind) ?? "openai",
  );
  const [baseUrl, setBaseUrl] = useState(
    existing?.baseUrl ?? KIND_DEFAULTS["openai"].baseUrl,
  );
  const [defaultModel, setDefaultModel] = useState(
    existing?.defaultModel ?? KIND_DEFAULTS["openai"].defaultModel,
  );
  const [apiKey, setApiKey] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | "none">(
    (existing?.reasoningEffort as ReasoningEffort) ?? "none",
  );
  const [kwargRows, setKwargRows] = useState<KwargRow[]>(() => {
    const seed = existing?.chatTemplateKwargs;
    if (!seed) return [];
    return Object.entries(seed).map(([k, v]) =>
      newRow(k, typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v)),
    );
  });

  const kwargsResult = useMemo(() => buildKwargs(kwargRows), [kwargRows]);

  function setKwargKey(id: string, key: string) {
    setKwargRows((rs) => rs.map((r) => (r.id === id ? { ...r, key } : r)));
    invalidateTest();
  }
  function setKwargRaw(id: string, raw: string) {
    setKwargRows((rs) => rs.map((r) => (r.id === id ? { ...r, raw } : r)));
    invalidateTest();
  }
  function addKwarg(key = "", raw = "") {
    setKwargRows((rs) => [...rs, newRow(key, raw)]);
    invalidateTest();
  }
  function deleteKwarg(id: string) {
    setKwargRows((rs) => rs.filter((r) => r.id !== id));
    invalidateTest();
  }
  const [tested, setTested] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [testing, startTest] = useTransition();
  const [pending, start] = useTransition();

  function invalidateTest() {
    if (tested) setTested(false);
    if (testError) setTestError(null);
    if (submitError) setSubmitError(null);
    if (submitSuccess) setSubmitSuccess(null);
  }

  function onKindChange(v: string) {
    const k = v as ProviderKind;
    setKind(k);
    const d = KIND_DEFAULTS[k];
    if (d) {
      setBaseUrl(d.baseUrl);
      setDefaultModel(d.defaultModel);
    }
    invalidateTest();
  }

  function onTest() {
    if (!baseUrl || !defaultModel) {
      setTestError("Base URL and default model are required to test");
      setTested(false);
      return;
    }
    if (!isEdit && !apiKey) {
      setTestError("API key is required to test a new provider");
      setTested(false);
      return;
    }
    if (kwargsResult.error) {
      setTestError(kwargsResult.error);
      setTested(false);
      return;
    }
    startTest(async () => {
      const res = await testProviderConnection({
        projectId,
        id: existing?.id ?? null,
        baseUrl,
        apiKey: apiKey || null,
        model: defaultModel,
        reasoningEffort: reasoningEffort === "none" ? null : reasoningEffort,
        chatTemplateKwargs:
          Object.keys(kwargsResult.value).length > 0 ? kwargsResult.value : null,
      });
      if ("error" in res && res.error) {
        setTested(false);
        setTestError(res.error);
      } else {
        setTested(true);
        setTestError(null);
      }
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);
    if (!tested) {
      setSubmitError("Test the connection first");
      return;
    }
    if (kwargsResult.error) {
      setSubmitError(kwargsResult.error);
      return;
    }
    start(async () => {
      const ctk =
        Object.keys(kwargsResult.value).length > 0 ? kwargsResult.value : null;
      const reasoning = reasoningEffort === "none" ? null : reasoningEffort;

      const res = isEdit
        ? await updateProvider({
            projectId,
            id: existing!.id,
            name,
            kind,
            baseUrl,
            apiKey: apiKey || null,
            defaultModel: defaultModel || null,
            reasoningEffort: reasoning,
            chatTemplateKwargs: ctk,
          })
        : await createProvider({
            projectId,
            name,
            kind,
            baseUrl,
            apiKey,
            defaultModel: defaultModel || null,
            reasoningEffort: reasoning,
            chatTemplateKwargs: ctk,
          });

      if ("error" in res && res.error) {
        setSubmitError(res.error);
      } else if (isEdit) {
        setSubmitSuccess(`Provider “${name}” saved.`);
        setApiKey("");
        onSaved?.();
      } else {
        setSubmitSuccess(`Provider “${name}” added.`);
        setName("");
        setApiKey("");
        setTested(false);
        setTestError(null);
      }
    });
  }

  const fields = (
    <>
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
            onChange={(e) => {
              setBaseUrl(e.target.value);
              invalidateTest();
            }}
            placeholder="https://api.openai.com/v1"
            required
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="pv-key">
            API key{isEdit ? " (leave blank to keep current)" : ""}
          </Label>
          <Input
            id="pv-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              invalidateTest();
            }}
            placeholder={isEdit ? `current: ${existing?.keyFingerprint ?? ""}` : ""}
            required={!isEdit}
          />
          <p className="text-xs text-muted-foreground">
            Encrypted with AES-256-GCM before storage. Decrypted only inside the Python worker.
          </p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="pv-model">Default model (required for test)</Label>
          <Input
            id="pv-model"
            value={defaultModel}
            onChange={(e) => {
              setDefaultModel(e.target.value);
              invalidateTest();
            }}
            placeholder="gpt-4o-mini"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="pv-reasoning">Reasoning effort</Label>
          <Select
            value={reasoningEffort}
            onValueChange={(v) => {
              setReasoningEffort(v as ReasoningEffort | "none");
              invalidateTest();
            }}
          >
            <SelectTrigger id="pv-reasoning">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Don't send</SelectItem>
              <SelectItem value="minimal">minimal</SelectItem>
              <SelectItem value="low">low</SelectItem>
              <SelectItem value="medium">medium</SelectItem>
              <SelectItem value="high">high</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Sent as <code>reasoning_effort</code> on every request. For OpenAI o-series
            and other providers that accept it.
          </p>
        </div>

      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>chat_template_kwargs</Label>
          <div className="flex gap-2">
            {kwargRows.length === 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addKwarg("enable_thinking", "false")}
              >
                + Disable Qwen3 thinking
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => addKwarg()}>
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
          </div>
        </div>

        {kwargRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None — body sent without <code>chat_template_kwargs</code>. For Qwen3 vLLM
            click <em>Disable Qwen3 thinking</em> to add{" "}
            <code>enable_thinking: false</code>.
          </p>
        ) : (
          <div className="space-y-2">
            {kwargRows.map((row) => (
              <div key={row.id} className="flex items-start gap-2">
                <Input
                  className="font-mono text-xs"
                  value={row.key}
                  onChange={(e) => setKwargKey(row.id, e.target.value)}
                  placeholder="enable_thinking"
                />
                <Input
                  className="font-mono text-xs"
                  value={row.raw}
                  onChange={(e) => setKwargRaw(row.id, e.target.value)}
                  placeholder='false  /  "low"  /  42  /  ["a","b"]'
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteKwarg(row.id)}
                  aria-label="Delete kwarg"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Values are parsed as JSON when possible (so <code>true</code> /{" "}
              <code>42</code> / <code>"hello"</code>) and fall back to raw string
              otherwise. If a row sets <code>enable_thinking</code>, the worker also
              mirrors it to top-level <code>include_reasoning</code> to fully suppress
              vLLM Qwen3 thinking.
            </p>
            <pre className="overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-[11px]">
              {kwargsResult.error
                ? `// ${kwargsResult.error}`
                : Object.keys(kwargsResult.value).length === 0
                  ? "// (no kwargs sent)"
                  : `chat_template_kwargs: ${JSON.stringify(kwargsResult.value, null, 2)}`}
            </pre>
          </div>
        )}
      </div>

    </>
  );

  const statusBlock = (
    <>
      {testError && (
        <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
          <span className="font-medium">Test failed:</span> {testError}
        </p>
      )}
      {tested && !testError && (
        <p className="text-xs text-green-600">
          Chat completion succeeded — you can {isEdit ? "save" : "add"} the provider.
        </p>
      )}
      {!tested && !testError && (
        <p className="text-xs text-muted-foreground">
          Test a chat completion before {isEdit ? "saving" : "adding"}.
        </p>
      )}
      {submitError && (
        <p className="whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert">
          {submitError}
        </p>
      )}
      {submitSuccess && (
        <p className="text-xs text-green-600" role="status">
          {submitSuccess}
        </p>
      )}
    </>
  );

  const actionButtons = (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        onClick={onTest}
        disabled={testing || !baseUrl || !defaultModel || (!isEdit && !apiKey)}
      >
        {testing ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : tested ? (
          <Check className="mr-2 h-4 w-4 text-green-600" />
        ) : null}
        {testing ? "Testing…" : tested ? "Connection OK" : "Test connection"}
      </Button>

      <Button type="submit" disabled={pending || !tested}>
        {!isEdit && <Plus className="mr-2 h-4 w-4" />}
        {pending
          ? isEdit
            ? "Saving…"
            : "Adding…"
          : isEdit
            ? "Save changes"
            : "Add provider"}
      </Button>
    </div>
  );

  if (card) {
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{card.title}</CardTitle>
            {card.description && (
              <CardDescription>{card.description}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {fields}
            {statusBlock}
          </CardContent>
        </Card>
        <div className="flex justify-end">{actionButtons}</div>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {fields}
      <div className="space-y-2">
        {statusBlock}
        {actionButtons}
      </div>
    </form>
  );
}
