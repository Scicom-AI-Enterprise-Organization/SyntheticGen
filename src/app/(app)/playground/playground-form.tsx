"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Play, Square, Upload, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface ProviderOption {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  defaultModel: string | null;
  reasoningEffort: string | null;
  chatTemplateKwargs: string | null; // JSON-stringified
}

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

type ToolCallAcc = {
  index: number;
  id: string | null;
  name: string;
  argsBuf: string;
};

type StreamState = {
  content: string;
  reasoning: string;
  toolCalls: ToolCallAcc[];
  finishReason: string | null;
  tokensIn: number;
  tokensOut: number;
  model: string | null;
  rawFrames: number;
};

// Sample tool catalog used by the "Sample" button. 8 diverse OpenAI-shape
// function specs covering the common test surfaces — required + optional
// params, enums, arrays of strings, nested objects, integer defaults — so
// the playground exercises a realistic mix on a single click.
const DEFAULT_TOOLS_PLACEHOLDER = `[
  {
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get the current weather in a given location",
      "parameters": {
        "type": "object",
        "properties": {
          "location": {
            "type": "string",
            "description": "The city and state, e.g. Kuala Lumpur, MY"
          },
          "unit": {
            "type": "string",
            "enum": ["celsius", "fahrenheit"]
          }
        },
        "required": ["location"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_stock_price",
      "description": "Get the latest stock price for a given ticker symbol",
      "parameters": {
        "type": "object",
        "properties": {
          "ticker": {
            "type": "string",
            "description": "Stock ticker symbol, e.g. AAPL, MAYBANK"
          },
          "exchange": {
            "type": "string",
            "description": "Exchange code, e.g. NASDAQ, KLSE"
          }
        },
        "required": ["ticker"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "search_flights",
      "description": "Search for available flights between two airports on a given date",
      "parameters": {
        "type": "object",
        "properties": {
          "origin": {
            "type": "string",
            "description": "IATA code of departure airport, e.g. KUL"
          },
          "destination": {
            "type": "string",
            "description": "IATA code of arrival airport, e.g. SIN"
          },
          "date": {
            "type": "string",
            "description": "Departure date in YYYY-MM-DD format"
          },
          "passengers": {
            "type": "integer",
            "description": "Number of passengers",
            "default": 1
          }
        },
        "required": ["origin", "destination", "date"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "send_email",
      "description": "Send an email to a recipient",
      "parameters": {
        "type": "object",
        "properties": {
          "to": {
            "type": "string",
            "description": "Recipient email address"
          },
          "subject": {
            "type": "string",
            "description": "Email subject line"
          },
          "body": {
            "type": "string",
            "description": "Email body content"
          },
          "cc": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Optional list of CC recipients"
          }
        },
        "required": ["to", "subject", "body"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "calculate",
      "description": "Evaluate a math expression and return the result",
      "parameters": {
        "type": "object",
        "properties": {
          "expression": {
            "type": "string",
            "description": "A math expression, e.g. '2 * (3 + 4)'"
          }
        },
        "required": ["expression"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "translate_text",
      "description": "Translate text from one language to another",
      "parameters": {
        "type": "object",
        "properties": {
          "text": {
            "type": "string",
            "description": "The text to translate"
          },
          "source_lang": {
            "type": "string",
            "description": "Source language code, e.g. 'en', 'ms', 'zh'"
          },
          "target_lang": {
            "type": "string",
            "description": "Target language code, e.g. 'en', 'ms', 'zh'"
          }
        },
        "required": ["text", "target_lang"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "create_calendar_event",
      "description": "Create an event on the user's calendar",
      "parameters": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "description": "Event title"
          },
          "start_time": {
            "type": "string",
            "description": "ISO 8601 start datetime, e.g. 2026-05-10T14:00:00+08:00"
          },
          "end_time": {
            "type": "string",
            "description": "ISO 8601 end datetime"
          },
          "attendees": {
            "type": "array",
            "items": { "type": "string" },
            "description": "List of attendee emails"
          },
          "location": {
            "type": "string",
            "description": "Optional location"
          }
        },
        "required": ["title", "start_time", "end_time"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "web_search",
      "description": "Search the web and return top results",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "Search query"
          },
          "top_k": {
            "type": "integer",
            "description": "Number of results to return",
            "default": 5
          }
        },
        "required": ["query"]
      }
    }
  }
]`;

const DEFAULT_CHAT_TEMPLATE_KWARGS = `{"enable_thinking": true}`;

export function PlaygroundForm({ providers }: { providers: ProviderOption[] }) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const provider = useMemo(
    () => providers.find((p) => p.id === providerId) ?? null,
    [providers, providerId],
  );
  const [model, setModel] = useState(providers[0]?.defaultModel ?? "");
  const [messages, setMessages] = useState<Message[]>([
    { role: "user", content: "Hello, world" },
  ]);
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(1.0);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [seed, setSeed] = useState<string>("");
  const [streamFlag, setStreamFlag] = useState(true);
  const [toolsJson, setToolsJson] = useState("");
  const [toolChoice, setToolChoice] = useState<string>("auto");
  const [forcedToolName, setForcedToolName] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<string>(
    providers[0]?.reasoningEffort ?? "none",
  );
  const [chatTemplateKwargs, setChatTemplateKwargs] = useState<string>(
    providers[0]?.chatTemplateKwargs ?? "",
  );
  const [extraJson, setExtraJson] = useState<string>("");

  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const [rawLog, setRawLog] = useState<string[]>([]);
  const [requestEcho, setRequestEcho] = useState<{
    url: string;
    headers: Record<string, string>;
    payload: unknown;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Sync provider defaults when the provider changes — but only if the
  // user hasn't explicitly customised the affected field.
  const onProviderChange = useCallback(
    (id: string) => {
      const p = providers.find((x) => x.id === id);
      setProviderId(id);
      if (p?.defaultModel) setModel(p.defaultModel);
      if (p?.reasoningEffort) setReasoningEffort(p.reasoningEffort);
      else setReasoningEffort("none");
      setChatTemplateKwargs(p?.chatTemplateKwargs ?? "");
    },
    [providers],
  );

  function addMessage(role: Message["role"]) {
    setMessages((m) => [...m, { role, content: "" }]);
  }
  function updateMessage(i: number, patch: Partial<Message>) {
    setMessages((m) => m.map((msg, j) => (i === j ? { ...msg, ...patch } : msg)));
  }
  function removeMessage(i: number) {
    setMessages((m) => m.filter((_, j) => j !== i));
  }

  async function run() {
    setError(null);
    setRequestEcho(null);
    setRawLog([]);
    setStreamState({
      content: "",
      reasoning: "",
      toolCalls: [],
      finishReason: null,
      tokensIn: 0,
      tokensOut: 0,
      model: null,
      rawFrames: 0,
    });

    // Parse JSON inputs up front so we fail fast with a useful message.
    let tools: unknown[] | null = null;
    if (toolsJson.trim()) {
      try {
        const parsed = JSON.parse(toolsJson);
        if (!Array.isArray(parsed)) throw new Error("tools must be a JSON array");
        tools = parsed;
      } catch (e) {
        setError(`tools: ${(e as Error).message}`);
        return;
      }
    }
    let ctk: Record<string, unknown> | null = null;
    if (chatTemplateKwargs.trim()) {
      try {
        const parsed = JSON.parse(chatTemplateKwargs);
        if (typeof parsed !== "object" || !parsed || Array.isArray(parsed)) {
          throw new Error("chat_template_kwargs must be a JSON object");
        }
        ctk = parsed as Record<string, unknown>;
      } catch (e) {
        setError(`chat_template_kwargs: ${(e as Error).message}`);
        return;
      }
    }
    let extra: Record<string, unknown> | null = null;
    if (extraJson.trim()) {
      try {
        const parsed = JSON.parse(extraJson);
        if (typeof parsed !== "object" || !parsed || Array.isArray(parsed)) {
          throw new Error("extra must be a JSON object");
        }
        extra = parsed as Record<string, unknown>;
      } catch (e) {
        setError(`extra: ${(e as Error).message}`);
        return;
      }
    }

    let tcResolved: unknown = "auto";
    if (toolChoice === "auto") tcResolved = "auto";
    else if (toolChoice === "required") tcResolved = "required";
    else if (toolChoice === "none") tcResolved = "none";
    else if (toolChoice === "function" && forcedToolName.trim()) {
      tcResolved = {
        type: "function",
        function: { name: forcedToolName.trim() },
      };
    }

    const body = {
      providerId,
      model,
      messages: messages.filter((m) => m.content.trim() || m.role === "assistant"),
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
      seed: seed.trim() ? Number(seed) : null,
      stream: streamFlag,
      tools,
      tool_choice: tools ? tcResolved : undefined,
      reasoning_effort: reasoningEffort === "none" ? null : reasoningEffort,
      chat_template_kwargs: ctk,
      extra,
    };

    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    try {
      const res = await fetch("/api/playground/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        setError(`HTTP ${res.status}: ${txt.slice(0, 500)}`);
        setRunning(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
          }
          if (dataLines.length === 0) continue;
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(dataLines.join("\n"));
          } catch {
            continue;
          }
          handleEvent(parsed);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(`stream failed: ${(e as Error).message}`);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  function handleEvent(ev: Record<string, unknown>) {
    setRawLog((prev) => [...prev, JSON.stringify(ev)]);
    const kind = ev.event as string | undefined;
    if (kind === "request") {
      setRequestEcho({
        url: ev.url as string,
        headers: (ev.headers as Record<string, string>) ?? {},
        payload: ev.payload,
      });
      return;
    }
    if (kind === "error") {
      setError(`upstream ${(ev.status as number | undefined) ?? "?"}: ${(ev.body as string | undefined) ?? ""}`);
      return;
    }
    if (kind === "done") {
      return;
    }
    if (kind === "json") {
      // Non-streaming response — synthesize a single big chunk.
      const json = ev.payload as Record<string, unknown>;
      const choices = (json.choices as Array<Record<string, unknown>> | undefined) ?? [];
      const msg = (choices[0]?.message ?? {}) as Record<string, unknown>;
      const usage = (json.usage as Record<string, number> | undefined) ?? {};
      setStreamState((s) => ({
        ...(s ?? emptyStream()),
        content: (msg.content as string) ?? "",
        reasoning:
          (msg.reasoning_content as string) ?? (msg.reasoning as string) ?? "",
        toolCalls: normalizeToolCallsBlock(msg.tool_calls),
        finishReason: (choices[0]?.finish_reason as string) ?? null,
        tokensIn: usage.prompt_tokens ?? 0,
        tokensOut: usage.completion_tokens ?? 0,
        model: (json.model as string) ?? null,
        rawFrames: (s?.rawFrames ?? 0) + 1,
      }));
      return;
    }
    if (kind === "chunk") {
      const payload = ev.payload as Record<string, unknown>;
      const choices = (payload.choices as Array<Record<string, unknown>> | undefined) ?? [];
      const usage = payload.usage as Record<string, number> | undefined;
      const mdl = payload.model as string | undefined;
      setStreamState((s) => {
        const next: StreamState = { ...(s ?? emptyStream()) };
        next.rawFrames = (s?.rawFrames ?? 0) + 1;
        if (mdl) next.model = mdl;
        for (const c of choices) {
          const delta = (c.delta as Record<string, unknown> | undefined) ?? {};
          const reasoning =
            (delta.reasoning as string | undefined) ??
            (delta.reasoning_content as string | undefined);
          if (typeof reasoning === "string" && reasoning.length > 0) {
            next.reasoning += reasoning;
          }
          const content = delta.content as string | undefined;
          if (typeof content === "string" && content.length > 0) {
            next.content += content;
          }
          const tcs = delta.tool_calls as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(tcs)) {
            next.toolCalls = mergeToolCallDeltas(next.toolCalls, tcs);
          }
          if (typeof c.finish_reason === "string") {
            next.finishReason = c.finish_reason;
          }
        }
        if (usage) {
          if (typeof usage.prompt_tokens === "number") next.tokensIn = usage.prompt_tokens;
          if (typeof usage.completion_tokens === "number") next.tokensOut = usage.completion_tokens;
        }
        return next;
      });
      return;
    }
  }

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  function importFromRequests() {
    try {
      const parsed = parsePythonRequestsSnippet(importText);
      if (parsed.model) setModel(parsed.model);
      if (parsed.messages) setMessages(parsed.messages);
      if (parsed.tools) setToolsJson(JSON.stringify(parsed.tools, null, 2));
      if (parsed.tool_choice !== undefined) {
        if (typeof parsed.tool_choice === "string") {
          setToolChoice(parsed.tool_choice);
        } else if (
          parsed.tool_choice &&
          typeof parsed.tool_choice === "object" &&
          (parsed.tool_choice as Record<string, unknown>).type === "function"
        ) {
          setToolChoice("function");
          const fn = (parsed.tool_choice as { function?: { name?: string } }).function;
          if (fn?.name) setForcedToolName(fn.name);
        }
      }
      if (typeof parsed.temperature === "number") setTemperature(parsed.temperature);
      if (typeof parsed.top_p === "number") setTopP(parsed.top_p);
      if (typeof parsed.max_tokens === "number") setMaxTokens(parsed.max_tokens);
      if (typeof parsed.reasoning_effort === "string") setReasoningEffort(parsed.reasoning_effort);
      if (parsed.chat_template_kwargs) {
        setChatTemplateKwargs(JSON.stringify(parsed.chat_template_kwargs));
      }
      setImportOpen(false);
      setError(null);
    } catch (e) {
      setError(`import failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {/* Provider + model + import */}
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="pg-provider">Global provider</Label>
              <Select value={providerId} onValueChange={onProviderChange}>
                <SelectTrigger id="pg-provider">
                  <SelectValue />
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
              {provider && (
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {provider.baseUrl}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pg-model">Model</Label>
              <Input
                id="pg-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. google/gemma-4-31b-it"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="invisible">.</Label>
              <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" type="button">
                    <Upload className="mr-2 h-4 w-4" />
                    Import requests
                  </Button>
                </DialogTrigger>
                <DialogContent className="flex max-h-[85vh] w-[min(96vw,1000px)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
                  <DialogHeader className="border-b border-border p-4 pb-3">
                    <DialogTitle>Import from Python requests</DialogTitle>
                    <DialogDescription>
                      Paste a Python snippet that builds <code>headers</code> /{" "}
                      <code>json_data</code> and calls{" "}
                      <code>requests.post(url, headers=…, json=…)</code>. We
                      extract <code>model</code>, <code>messages</code>,{" "}
                      <code>tools</code>, <code>tool_choice</code>,{" "}
                      <code>temperature</code>, <code>top_p</code>,{" "}
                      <code>max_tokens</code>,{" "}
                      <code>chat_template_kwargs</code>, and{" "}
                      <code>reasoning_effort</code>. The URL and Authorization
                      from the snippet are ignored — credentials come from the
                      selected global provider.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <Textarea
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      className="min-h-[300px] font-mono text-xs"
                      placeholder={`headers = {\n    'Authorization': 'Bearer ...',\n}\n\njson_data = {\n    'messages': [{'role': 'user', 'content': 'Hello'}],\n    'model': 'google/gemma-4-31b-it',\n    'chat_template_kwargs': {'enable_thinking': True}\n}\n\nrequests.post('https://...', headers=headers, json=json_data)`}
                    />
                  </div>
                  <DialogFooter className="border-t border-border p-4">
                    <Button variant="ghost" onClick={() => setImportOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={importFromRequests} disabled={!importText.trim()}>
                      Import
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Messages */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Messages</Label>
              <div className="flex gap-1">
                {(["system", "user", "assistant", "tool"] as const).map((r) => (
                  <Button
                    key={r}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => addMessage(r)}
                    className="h-7 text-[11px]"
                  >
                    <Plus className="mr-1 h-3 w-3" /> {r}
                  </Button>
                ))}
              </div>
            </div>
            {messages.map((m, i) => (
              <div key={i} className="space-y-1 rounded-md border border-border p-2">
                <div className="flex items-center justify-between">
                  <Select
                    value={m.role}
                    onValueChange={(v) => updateMessage(i, { role: v as Message["role"] })}
                  >
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">system</SelectItem>
                      <SelectItem value="user">user</SelectItem>
                      <SelectItem value="assistant">assistant</SelectItem>
                      <SelectItem value="tool">tool</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeMessage(i)}
                    className="h-7 w-7 p-0"
                    aria-label="Remove message"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <Textarea
                  value={m.content}
                  onChange={(e) => updateMessage(i, { content: e.target.value })}
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>
            ))}
          </div>

          {/* Tools — collapsible so it doesn't push the Run button below
              the fold. Closed by default; auto-summarises the current
              entry count in the heading so users can tell at a glance
              whether anything is loaded. */}
          <details className="rounded-md border border-border bg-background/40">
            <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2">
              <span className="text-sm font-medium">
                Tools (JSON array)
                {toolsJson.trim() && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {(() => {
                      try {
                        const v = JSON.parse(toolsJson);
                        if (Array.isArray(v)) {
                          return `· ${v.length} tool${v.length === 1 ? "" : "s"}`;
                        }
                      } catch {
                        /* fall through */
                      }
                      return "· invalid JSON";
                    })()}
                  </span>
                )}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={(e) => {
                  // Don't toggle the details open/closed when clicking
                  // the inner button — just drop in the sample text.
                  e.preventDefault();
                  e.stopPropagation();
                  setToolsJson(DEFAULT_TOOLS_PLACEHOLDER);
                  // Force the panel open after filling so the user sees
                  // the inserted content.
                  const root = (e.currentTarget as HTMLButtonElement).closest("details");
                  if (root) root.open = true;
                }}
              >
                Sample
              </Button>
            </summary>
            <div className="border-t border-border p-2">
              <Textarea
                id="pg-tools"
                value={toolsJson}
                onChange={(e) => setToolsJson(e.target.value)}
                rows={10}
                className="font-mono text-xs"
                placeholder={DEFAULT_TOOLS_PLACEHOLDER}
              />
            </div>
          </details>
        </div>

        {/* Right column: knobs */}
        <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Tool choice</Label>
            <Select value={toolChoice} onValueChange={setToolChoice}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto</SelectItem>
                <SelectItem value="required">required</SelectItem>
                <SelectItem value="none">none</SelectItem>
                <SelectItem value="function">force function…</SelectItem>
              </SelectContent>
            </Select>
            {toolChoice === "function" && (
              <Input
                value={forcedToolName}
                onChange={(e) => setForcedToolName(e.target.value)}
                placeholder="function name"
                className="font-mono text-xs"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Reasoning effort</Label>
            <Select value={reasoningEffort} onValueChange={setReasoningEffort}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">(unset)</SelectItem>
                <SelectItem value="minimal">minimal</SelectItem>
                <SelectItem value="low">low</SelectItem>
                <SelectItem value="medium">medium</SelectItem>
                <SelectItem value="high">high</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pg-ctk" className="text-xs">
              chat_template_kwargs
            </Label>
            <div className="flex gap-1">
              <Input
                id="pg-ctk"
                value={chatTemplateKwargs}
                onChange={(e) => setChatTemplateKwargs(e.target.value)}
                placeholder="{}"
                className="font-mono text-[11px]"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setChatTemplateKwargs(DEFAULT_CHAT_TEMPLATE_KWARGS)}
                className="shrink-0 text-[10px]"
              >
                thinking
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Temperature</Label>
              <span className="font-mono text-[10px] text-muted-foreground">
                {temperature.toFixed(2)}
              </span>
            </div>
            <Slider
              min={0}
              max={2}
              step={0.05}
              value={[temperature]}
              onValueChange={([v]) => setTemperature(v)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">top_p</Label>
              <span className="font-mono text-[10px] text-muted-foreground">
                {topP.toFixed(2)}
              </span>
            </div>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={[topP]}
              onValueChange={([v]) => setTopP(v)}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">max_tokens</Label>
              <span className="font-mono text-[10px] text-muted-foreground">
                {maxTokens}
              </span>
            </div>
            <Slider
              min={64}
              max={32_000}
              step={64}
              value={[maxTokens]}
              onValueChange={([v]) => setMaxTokens(v)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">seed</Label>
            <Input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="(none)"
              className="font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-1.5">
            <Label htmlFor="pg-stream" className="cursor-pointer text-xs">
              Stream
            </Label>
            <input
              id="pg-stream"
              type="checkbox"
              checked={streamFlag}
              onChange={(e) => setStreamFlag(e.target.checked)}
            />
          </div>

          <details className="rounded-md border border-border bg-background/40">
            <summary className="cursor-pointer select-none px-2 py-1.5 text-[11px] font-medium">
              Extra (raw JSON merge)
            </summary>
            <div className="p-2 pt-1">
              <Textarea
                value={extraJson}
                onChange={(e) => setExtraJson(e.target.value)}
                rows={4}
                className="font-mono text-[10px]"
                placeholder='{"presence_penalty": 0.1}'
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Merged into the request body after the structured fields, so
                any key here wins.
              </p>
            </div>
          </details>
        </div>
      </div>

      {/* Right-aligned action row — flows inline with the rest of the
          form, no sticky chrome / negative margins, so it stays aligned
          with the content above. Run/Stop sits where the knobs column
          ends; any validation error inlines on the left. */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {error && (
          <p className="mr-auto rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
            {error}
          </p>
        )}
        {!running ? (
          <Button onClick={run} disabled={!providerId || !model.trim()} size="lg">
            <Play className="mr-2 h-4 w-4" />
            Run
          </Button>
        ) : (
          <Button variant="outline" onClick={stop} size="lg">
            <Square className="mr-2 h-4 w-4" />
            Stop
          </Button>
        )}
      </div>

      {/* Response panel */}
      {streamState && <ResponsePanel state={streamState} requestEcho={requestEcho} rawLog={rawLog} />}
    </div>
  );
}

function emptyStream(): StreamState {
  return {
    content: "",
    reasoning: "",
    toolCalls: [],
    finishReason: null,
    tokensIn: 0,
    tokensOut: 0,
    model: null,
    rawFrames: 0,
  };
}

function mergeToolCallDeltas(
  prev: ToolCallAcc[],
  deltas: Array<Record<string, unknown>>,
): ToolCallAcc[] {
  const next = prev.slice();
  for (const d of deltas) {
    const idx = typeof d.index === "number" ? d.index : 0;
    let slot = next.find((s) => s.index === idx);
    if (!slot) {
      slot = { index: idx, id: null, name: "", argsBuf: "" };
      next.push(slot);
    }
    if (typeof d.id === "string") slot.id = d.id;
    const fn = d.function as { name?: string; arguments?: string } | undefined;
    if (fn?.name) slot.name = fn.name;
    if (typeof fn?.arguments === "string") slot.argsBuf += fn.arguments;
  }
  return next.sort((a, b) => a.index - b.index);
}

function normalizeToolCallsBlock(raw: unknown): ToolCallAcc[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((tc, i) => {
    const r = (tc ?? {}) as Record<string, unknown>;
    const fn = (r.function ?? {}) as { name?: string; arguments?: string };
    return {
      index: typeof r.index === "number" ? r.index : i,
      id: typeof r.id === "string" ? r.id : null,
      name: fn.name ?? "",
      argsBuf: typeof fn.arguments === "string" ? fn.arguments : "",
    };
  });
}

function ResponsePanel({
  state,
  requestEcho,
  rawLog,
}: {
  state: StreamState;
  requestEcho: {
    url: string;
    headers: Record<string, string>;
    payload: unknown;
  } | null;
  rawLog: string[];
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge variant="outline">
          {state.tokensIn}/{state.tokensOut} tok
        </Badge>
        {state.model && (
          <Badge variant="outline" className="font-mono">
            {state.model}
          </Badge>
        )}
        {state.finishReason && (
          <Badge variant="outline">finish: {state.finishReason}</Badge>
        )}
        <Badge variant="outline" className="text-muted-foreground">
          {state.rawFrames} frames
        </Badge>
      </div>

      {state.reasoning && (
        <details open className="rounded-md border border-amber-500/30 bg-amber-500/5">
          <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            reasoning ({state.reasoning.length} chars)
          </summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-amber-500/30 px-2 py-1.5 font-mono text-[11px] italic text-amber-900 dark:text-amber-100">
            {state.reasoning}
          </pre>
        </details>
      )}

      {state.toolCalls.length > 0 && (
        <details open className="rounded-md border border-purple-500/30 bg-purple-500/5">
          <summary className="cursor-pointer select-none px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-300">
            tool_calls ({state.toolCalls.length})
          </summary>
          <div className="space-y-2 border-t border-purple-500/30 px-2 py-1.5">
            {state.toolCalls.map((tc) => (
              <div key={tc.index} className="space-y-0.5 rounded border border-purple-500/20 bg-background/50 p-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-mono font-semibold">{tc.name || "(no name yet)"}</span>
                  {tc.id && (
                    <span className="text-muted-foreground">id: {tc.id}</span>
                  )}
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px]">
                  {tc.argsBuf || "(no args yet)"}
                </pre>
              </div>
            ))}
          </div>
        </details>
      )}

      {state.content && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            content
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px]">
            {state.content}
          </pre>
        </div>
      )}

      {requestEcho && (
        <details className="rounded-md border border-border bg-background/40">
          <summary className="cursor-pointer select-none px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            sent request
          </summary>
          <pre className="overflow-auto whitespace-pre-wrap break-all border-t border-border px-2 py-1.5 font-mono text-[10px]">
            POST {requestEcho.url}
            {"\n"}
            {Object.entries(requestEcho.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")}
            {"\n\n"}
            {JSON.stringify(requestEcho.payload, null, 2)}
          </pre>
        </details>
      )}

      <details className="rounded-md border border-border bg-background/40">
        <summary className="cursor-pointer select-none px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          raw SSE log ({rawLog.length})
        </summary>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-border px-2 py-1.5 font-mono text-[9px]">
          {rawLog.join("\n")}
        </pre>
      </details>
    </div>
  );
}

// ── Python `requests.post` importer ────────────────────────────────────────
// We parse the JSON-like literals out of a simple Python snippet — enough
// for the common shape: a top-level `json_data = { ... }` dict with the
// chat-completion keys we care about. We tolerate Python booleans, None,
// and trailing commas (the things JSON.parse doesn't accept) by
// substituting before parsing.

type ParsedSnippet = {
  model?: string;
  messages?: Message[];
  tools?: unknown[];
  tool_choice?: unknown;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  chat_template_kwargs?: Record<string, unknown>;
  reasoning_effort?: string;
};

function parsePythonRequestsSnippet(snippet: string): ParsedSnippet {
  // Pull out the dict literal assigned to `json_data` (or `payload`,
  // `json_payload`, `body`). We find the variable name and then match
  // a balanced { } block.
  const assignNames = ["json_data", "payload", "json_payload", "body"];
  let blockText: string | null = null;
  for (const name of assignNames) {
    const re = new RegExp(`${name}\\s*=\\s*\\{`, "m");
    const m = snippet.match(re);
    if (!m || m.index === undefined) continue;
    const open = m.index + m[0].length - 1;
    blockText = extractBalanced(snippet, open, "{", "}");
    if (blockText) break;
  }
  if (!blockText) {
    throw new Error(
      "couldn't find a dict literal assigned to json_data / payload / body",
    );
  }
  const json = pythonishToJson(blockText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(
      `dict literal didn't parse as JSON after normalisation: ${(e as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("dict literal is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  const out: ParsedSnippet = {};
  if (typeof obj.model === "string") out.model = obj.model;
  if (Array.isArray(obj.messages)) {
    out.messages = (obj.messages as Array<Record<string, unknown>>)
      .map((m) => ({
        role: (m.role as Message["role"]) ?? "user",
        content: typeof m.content === "string" ? m.content : "",
      }))
      .filter((m) => ["system", "user", "assistant", "tool"].includes(m.role));
  }
  if (Array.isArray(obj.tools)) out.tools = obj.tools;
  if (obj.tool_choice !== undefined) out.tool_choice = obj.tool_choice;
  if (typeof obj.temperature === "number") out.temperature = obj.temperature;
  if (typeof obj.top_p === "number") out.top_p = obj.top_p;
  if (typeof obj.max_tokens === "number") out.max_tokens = obj.max_tokens;
  if (typeof obj.max_completion_tokens === "number")
    out.max_tokens = obj.max_completion_tokens;
  if (
    obj.chat_template_kwargs &&
    typeof obj.chat_template_kwargs === "object" &&
    !Array.isArray(obj.chat_template_kwargs)
  ) {
    out.chat_template_kwargs = obj.chat_template_kwargs as Record<string, unknown>;
  }
  if (typeof obj.reasoning_effort === "string") {
    out.reasoning_effort = obj.reasoning_effort;
  }
  return out;
}

// Find a balanced {...} or [...] block starting at index `start` (must
// point at the opening bracket). Returns the substring including both
// brackets, or null if unbalanced.
function extractBalanced(
  text: string,
  start: number,
  open: string,
  close: string,
): string | null {
  if (text[start] !== open) return null;
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === stringChar) {
        inString = false;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Convert a Python dict literal string to JSON: single quotes → double,
// True/False/None → true/false/null, strip trailing commas. Conservative:
// only touches obvious cases so we don't corrupt content strings.
function pythonishToJson(text: string): string {
  // First pass — walk char by char and rewrite tokens outside strings.
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    // Strings: copy verbatim but rewrite single-quoted ones into
    // double-quoted JSON strings (and escape any embedded "s).
    if (c === '"' || c === "'") {
      const quote = c;
      let s = "";
      let j = i + 1;
      while (j < text.length) {
        const cc = text[j];
        if (cc === "\\" && j + 1 < text.length) {
          s += cc + text[j + 1];
          j += 2;
          continue;
        }
        if (cc === quote) break;
        s += cc;
        j += 1;
      }
      // s is the raw inner content (may have already-escaped JSON
      // escapes like \n / \" — leave those alone, the JSON parser will
      // interpret them).
      if (quote === "'") {
        // We must escape any literal " inside the body for JSON.
        s = s.replace(/(?<!\\)"/g, '\\"');
      }
      out += `"${s}"`;
      i = j + 1;
      continue;
    }
    // Boolean / None keywords — only rewrite when surrounded by non-
    // identifier characters so we don't touch e.g. `Truely` inside an
    // identifier (defensive — Python doesn't allow this but be safe).
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j += 1;
      const word = text.slice(i, j);
      if (word === "True") out += "true";
      else if (word === "False") out += "false";
      else if (word === "None") out += "null";
      else out += word;
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  // Strip trailing commas before } or ].
  return out.replace(/,\s*([}\]])/g, "$1");
}
