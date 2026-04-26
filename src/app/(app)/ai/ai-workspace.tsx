"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Send,
  Mic,
  Volume2,
  Sparkles,
  Headphones,
  ListChecks,
  ThumbsUp,
  ThumbsDown,
  Square,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Role = "assistant" | "user";

interface Message {
  id: string;
  role: Role;
  text: string;
  feedback?: "up" | "down";
  sources?: string[];
}

const QUICK_ACTIONS = [
  "Summarize this quarter's revenue",
  "Draft a password-reset email",
  "Explain RBAC in this app",
  "Show top 3 onboarding tips",
];

const STRUCTURED_FLOW = {
  prompt: "Pick a report format to generate:",
  options: ["PDF", "Excel", "Markdown"],
};

const SUGGESTED_RESPONSES = [
  "I can help reset your password — would you like an email or SMS link?",
  "Based on policy, refunds within 30 days are processed automatically.",
  "Let me pull up your most recent ticket for context.",
];

const KB_ARTICLES = [
  {
    title: "Password Reset Policy",
    body: "Users can reset via email or SMS verification within 15 minutes…",
  },
  {
    title: "Account Recovery",
    body: "For locked accounts, verify identity with security questions…",
  },
  {
    title: "Refund Eligibility",
    body: "Refunds within 30 days are auto-approved; beyond requires review…",
  },
];

let idSeed = 1;
const newId = () => `m${idSeed++}`;

function fakeAnswer(prompt: string): { text: string; sources?: string[] } {
  const lower = prompt.toLowerCase();
  if (lower.includes("revenue")) {
    return {
      text: "Revenue grew 12% QoQ — driven mostly by enterprise expansion in EMEA. Net retention is now 118%.",
      sources: ["analytics.example.com/q3", "finance/q3-deck.pdf"],
    };
  }
  if (lower.includes("password") || lower.includes("reset")) {
    return {
      text: "To reset a password: open Profile → Password, enter your current password, then a new one (≥8 chars). Admins can also issue an invite link.",
      sources: ["docs.example.com/auth"],
    };
  }
  if (lower.includes("rbac")) {
    return {
      text: "RBAC here is permission-based. Each Role grants Permissions like users:write or invites:read. UserRole maps users to roles. requirePermission() in server code enforces gates.",
      sources: ["src/lib/rbac.ts"],
    };
  }
  return {
    text: `Here's what I found about “${prompt}”. (Replace this with a real LLM call — see /api/ai for a starting point.)`,
    sources: ["docs.example.com"],
  };
}

export function AIWorkspace() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: newId(),
      role: "assistant",
      text: "Hi — I'm your workspace assistant. Try a quick action or type a question.",
    },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [structuredAnswer, setStructuredAnswer] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, typing]);

  useEffect(() => {
    if (!recording) return;
    const start = Date.now();
    const t = setInterval(() => setRecordingMs(Date.now() - start), 100);
    return () => clearInterval(t);
  }, [recording]);

  function send(prompt: string) {
    if (!prompt.trim()) return;
    const userMsg: Message = { id: newId(), role: "user", text: prompt };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const a = fakeAnswer(prompt);
      setMessages((m) => [
        ...m,
        { id: newId(), role: "assistant", text: a.text, sources: a.sources },
      ]);
      setTyping(false);
    }, 700);
  }

  function setFeedback(id: string, fb: "up" | "down") {
    setMessages((m) =>
      m.map((msg) =>
        msg.id === id ? { ...msg, feedback: msg.feedback === fb ? undefined : fb } : msg,
      ),
    );
  }

  function stopRecording() {
    setRecording(false);
    const transcript = "What's our Q3 revenue trend?";
    setRecordingMs(0);
    send(transcript);
  }

  const lastAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant"),
    [messages],
  );

  const matchedKb = useMemo(() => {
    if (!input) return null;
    const lower = input.toLowerCase();
    return (
      KB_ARTICLES.find((a) => lower.split(/\s+/).some((w) => a.title.toLowerCase().includes(w))) ??
      null
    );
  }, [input]);

  const matchedSuggestion = useMemo(() => {
    if (!input) return null;
    const lower = input.toLowerCase();
    if (lower.includes("password")) return SUGGESTED_RESPONSES[0];
    if (lower.includes("refund")) return SUGGESTED_RESPONSES[1];
    if (lower.includes("ticket")) return SUGGESTED_RESPONSES[2];
    return null;
  }, [input]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left/main — Chat */}
      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base">Assistant</CardTitle>
            <CardDescription>Traditional chatbot · typing indicator · feedback · sources</CardDescription>
          </div>
          <Badge variant="secondary">Online</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            ref={scrollRef}
            className="h-96 space-y-3 overflow-y-auto rounded-md border border-border bg-muted/20 p-3"
          >
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                playing={playingId === m.id}
                onPlayToggle={() => setPlayingId((p) => (p === m.id ? null : m.id))}
                onFeedback={(fb) => setFeedback(m.id, fb)}
              />
            ))}
            {typing && <TypingBubble />}
          </div>

          {/* Quick actions — structured chatbot pattern */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ListChecks className="h-3.5 w-3.5" /> Quick actions
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_ACTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="space-y-2"
          >
            {/* Agent assist — suggestion appears as user types */}
            {matchedSuggestion && (
              <div className="rounded-md border border-warning-500/30 bg-warning-500/10 p-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-warning-700 dark:text-warning-400">
                  <Sparkles className="h-3 w-3" /> Suggested response
                </div>
                <p className="mb-2 text-xs text-warning-700/90 dark:text-warning-300">
                  {matchedSuggestion}
                </p>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    className="h-6 text-[11px]"
                    onClick={() => setInput(matchedSuggestion)}
                  >
                    Use
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px]"
                    onClick={() => setInput((v) => v + " " + matchedSuggestion)}
                  >
                    Append
                  </Button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                placeholder="Ask anything…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={recording}
              />
              <Button
                type="button"
                variant={recording ? "destructive" : "outline"}
                size="icon"
                onClick={() => (recording ? stopRecording() : setRecording(true))}
                aria-label={recording ? "Stop recording" : "Start voice recording"}
              >
                {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button type="submit" size="icon" disabled={!input.trim() || recording}>
                <Send className="h-4 w-4" />
              </Button>
            </div>

            {/* Voice recording UI */}
            {recording && <RecordingBar ms={recordingMs} />}
          </form>
        </CardContent>
      </Card>

      {/* Right column — supporting AI patterns */}
      <div className="space-y-4">
        {/* Headless AI — summary card */}
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">AI Summary</CardTitle>
            <Badge variant="secondary" className="ml-auto">Auto</Badge>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {lastAssistant?.text ??
                "Your assistant's latest answer will summarize here."}
            </p>
          </CardContent>
        </Card>

        {/* Headless AI — inline metric with AI annotation */}
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Inline insight</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span>Quarterly revenue</span>
                <span className="font-medium">$45.2k</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted">
                <div className="h-1.5 w-[75%] rounded-full bg-primary" />
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs text-primary">
              <Bot className="h-3.5 w-3.5 shrink-0" />
              Pacing 12% above plan. Hiring is the leading indicator.
            </div>
          </CardContent>
        </Card>

        {/* Agent assist — knowledge base */}
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Headphones className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Knowledge base</CardTitle>
            <Badge variant="secondary" className="ml-auto">Live</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {(matchedKb ? [matchedKb] : KB_ARTICLES).map((a) => (
              <div
                key={a.title}
                className={cn(
                  "rounded-md border p-2 text-xs",
                  matchedKb?.title === a.title
                    ? "border-primary/40 bg-primary/5"
                    : "border-border",
                )}
              >
                <div className="font-medium">{a.title}</div>
                <p className="mt-0.5 text-muted-foreground">{a.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Structured chatbot — multi-step format picker */}
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <ListChecks className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Structured flow</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">
              {STRUCTURED_FLOW.prompt}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {STRUCTURED_FLOW.options.map((opt) => (
                <button
                  key={opt}
                  onClick={() =>
                    setStructuredAnswer(
                      `Generating ${opt} report…`,
                    )
                  }
                  className={cn(
                    "rounded border px-2 py-1.5 text-xs transition-colors",
                    structuredAnswer?.includes(opt)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
            {structuredAnswer && (
              <p className="mt-3 text-xs text-muted-foreground">
                {structuredAnswer}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  playing,
  onPlayToggle,
  onFeedback,
}: {
  message: Message;
  playing: boolean;
  onPlayToggle: () => void;
  onFeedback: (fb: "up" | "down") => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="max-w-[80%] space-y-1">
        <div className="rounded-lg rounded-tl-sm bg-muted px-3 py-2 text-sm">
          {message.text}
        </div>

        {/* Voice playback per assistant message */}
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <button
            onClick={onPlayToggle}
            className="inline-flex h-5 items-center gap-1 rounded px-1.5 hover:bg-muted"
            aria-label={playing ? "Stop playback" : "Play voice"}
          >
            {playing ? <Square className="h-2.5 w-2.5" /> : <Play className="h-2.5 w-2.5" />}
            <Volume2 className="h-3 w-3" />
          </button>
          {playing && <Waveform />}
        </div>

        {/* Feedback */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onFeedback("up")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
              message.feedback === "up"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <ThumbsUp className="h-3 w-3" /> helpful
          </button>
          <button
            onClick={() => onFeedback("down")}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
              message.feedback === "down"
                ? "bg-destructive/10 text-destructive"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            <ThumbsDown className="h-3 w-3" /> not helpful
          </button>
        </div>

        {/* Sources */}
        {message.sources && message.sources.length > 0 && (
          <div className="text-[10px] text-muted-foreground">
            Sources:{" "}
            {message.sources.map((s, i) => (
              <span key={s}>
                <span className="cursor-pointer text-primary hover:underline">{s}</span>
                {i < message.sources!.length - 1 && ", "}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="rounded-lg rounded-tl-sm bg-muted px-3 py-2.5">
        <div className="flex gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "0ms" }} />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "150ms" }} />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

function RecordingBar({ ms }: { ms: number }) {
  const seconds = Math.floor(ms / 1000)
    .toString()
    .padStart(2, "0");
  return (
    <div className="flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
      <Mic className="h-4 w-4 animate-pulse text-destructive" />
      <span className="text-xs font-medium text-destructive">Recording 0:{seconds}</span>
      <Waveform recording />
    </div>
  );
}

const WAVE_HEIGHTS = [10, 18, 12, 22, 14, 20, 8, 16, 24, 11, 17, 9];

function Waveform({ recording = false }: { recording?: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {WAVE_HEIGHTS.map((h, i) => (
        <div
          key={i}
          className={cn(
            "w-0.5 rounded-full",
            recording
              ? "bg-destructive/60 animate-pulse"
              : "bg-primary/60 animate-pulse",
          )}
          style={{ height: `${h}px`, animationDelay: `${i * 60}ms` }}
        />
      ))}
    </div>
  );
}
