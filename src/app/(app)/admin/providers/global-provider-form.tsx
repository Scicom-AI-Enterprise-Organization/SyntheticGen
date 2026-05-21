"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus } from "lucide-react";
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
import {
  createGlobalProvider,
  testGlobalProviderConnection,
  updateGlobalProvider,
} from "./actions";

type ProviderKind =
  | "openai"
  | "vllm"
  | "together"
  | "openrouter"
  | "sglang"
  | "anthropic-proxy"
  | "custom";
type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface ExistingGlobalProvider {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  defaultModel: string | null;
  reasoningEffort: string | null;
  keyFingerprint: string;
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

export function GlobalProviderForm({
  existing,
}: {
  existing?: ExistingGlobalProvider;
}) {
  const router = useRouter();
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
    startTest(async () => {
      const res = await testGlobalProviderConnection({
        id: existing?.id ?? null,
        baseUrl,
        apiKey: apiKey || null,
        model: defaultModel,
        reasoningEffort: reasoningEffort === "none" ? null : reasoningEffort,
        chatTemplateKwargs: null,
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
    start(async () => {
      const reasoning = reasoningEffort === "none" ? null : reasoningEffort;
      const res = isEdit
        ? await updateGlobalProvider({
            id: existing!.id,
            name,
            kind,
            baseUrl,
            apiKey: apiKey || null,
            defaultModel: defaultModel || null,
            reasoningEffort: reasoning,
            chatTemplateKwargs: null,
          })
        : await createGlobalProvider({
            name,
            kind,
            baseUrl,
            apiKey,
            defaultModel: defaultModel || null,
            reasoningEffort: reasoning,
            chatTemplateKwargs: null,
          });
      if ("error" in res && res.error) {
        setSubmitError(res.error);
        return;
      }
      setSubmitSuccess(
        isEdit
          ? `Provider “${name}” saved.`
          : `Provider “${name}” added.`,
      );
      if (!isEdit) {
        // Bounce to the list so the new row is visible — the form fields stay
        // populated in case the user wants to edit immediately.
        router.push("/admin/providers");
        router.refresh();
      } else {
        setApiKey("");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? "Edit global provider" : "New global provider"}</CardTitle>
          <CardDescription>
            Org-wide provider template. Project owners can import it into their
            own provider list — the import copies every field, including the
            encrypted API key.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="g-name">Name</Label>
              <Input
                id="g-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Org OpenAI"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="g-kind">Kind</Label>
              <Select value={kind} onValueChange={onKindChange as (v: string) => void}>
                <SelectTrigger id="g-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="vllm">vLLM (self-hosted)</SelectItem>
                  <SelectItem value="together">Together</SelectItem>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                  <SelectItem value="sglang">SGLang</SelectItem>
                  <SelectItem value="anthropic-proxy">
                    Anthropic (via OpenAI-compat proxy)
                  </SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="g-url">Base URL</Label>
              <Input
                id="g-url"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  invalidateTest();
                }}
                placeholder="https://api.openai.com/v1"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="g-key">
                API key{isEdit ? " (leave blank to keep current)" : ""}
              </Label>
              <Input
                id="g-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  invalidateTest();
                }}
                placeholder={isEdit ? `current: ${existing?.keyFingerprint ?? ""}` : ""}
              />
              <p className="text-xs text-muted-foreground">
                Encrypted with AES-256-GCM before storage. Decrypted only
                inside the Python worker. Imports copy the ciphertext as-is.
              </p>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="g-model">Default model (required for test)</Label>
              <Input
                id="g-model"
                value={defaultModel}
                onChange={(e) => {
                  setDefaultModel(e.target.value);
                  invalidateTest();
                }}
                placeholder="gpt-4o-mini"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="g-reasoning">Reasoning effort</Label>
              <Select
                value={reasoningEffort}
                onValueChange={(v) => {
                  setReasoningEffort(v as ReasoningEffort | "none");
                  invalidateTest();
                }}
              >
                <SelectTrigger id="g-reasoning">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Don&apos;t send</SelectItem>
                  <SelectItem value="minimal">minimal</SelectItem>
                  <SelectItem value="low">low</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="high">high</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

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
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
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
    </form>
  );
}
