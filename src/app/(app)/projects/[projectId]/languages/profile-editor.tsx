"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AiAssistButton } from "@/components/ai-assist-button";
import { upsertLanguageProfile } from "./actions";

interface Provider {
  id: string;
  name: string;
  defaultModel: string | null;
}

interface Initial {
  id?: string;
  name: string;
  primary: "ms" | "en" | "zh" | "ta";
  secondary: string[];
  script: "latin" | "jawi" | "hans" | "hant" | "tamil";
  codeSwitchPolicy: "none" | "inter-sentential" | "intra-sentential" | "rojak";
  codeSwitchRate: number | null;
  register: "formal" | "semi-formal" | "colloquial" | "mixed";
  allowParticles: boolean;
  bannedTokens: string[];
  bannedPatterns: string[];
  requireFormalMalay: boolean;
  englishLoanwordPolicy: "forbid" | "allowlist" | "free";
  loanwordAllowlist: string[];
  dialectHints: string[];
  notes: string | null;
}

const SECONDARY_OPTIONS = ["ms", "en", "zh", "ta"];

function csv(arr: string[]) {
  return arr.join(", ");
}
function parseCsv(s: string): string[] {
  return s
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function ProfileEditor({
  projectId,
  initial,
  providers,
}: {
  projectId: string;
  initial: Initial;
  providers: Provider[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(initial);
  const [bannedText, setBannedText] = useState(csv(initial.bannedTokens));
  const [allowText, setAllowText] = useState(csv(initial.loanwordAllowlist));
  const [dialectText, setDialectText] = useState(csv(initial.dialectHints));
  const [secondaryText, setSecondaryText] = useState(csv(initial.secondary));
  const [bannedPatternsText, setBannedPatternsText] = useState(csv(initial.bannedPatterns));

  function set<K extends keyof Initial>(k: K, v: Initial[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await upsertLanguageProfile({
        id: form.id,
        projectId,
        name: form.name,
        primary: form.primary,
        secondary: parseCsv(secondaryText).filter((x) => SECONDARY_OPTIONS.includes(x)),
        script: form.script,
        codeSwitchPolicy: form.codeSwitchPolicy,
        codeSwitchRate: form.codeSwitchRate,
        register: form.register,
        allowParticles: form.allowParticles,
        bannedTokens: parseCsv(bannedText),
        bannedPatterns: parseCsv(bannedPatternsText),
        requireFormalMalay: form.requireFormalMalay,
        englishLoanwordPolicy: form.englishLoanwordPolicy,
        loanwordAllowlist: parseCsv(allowText),
        dialectHints: parseCsv(dialectText),
        notes: form.notes,
      });
      if ("error" in res && res.error) toast.error(res.error);
      else {
        toast.success(form.id ? "Profile updated" : "Profile created");
        router.push(`/projects/${projectId}/languages`);
        router.refresh();
      }
    });
  }

  function applyAi(data: Record<string, unknown>) {
    const s = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null);
    const b = (k: string) => (typeof data[k] === "boolean" ? (data[k] as boolean) : null);
    const n = (k: string) => (typeof data[k] === "number" ? (data[k] as number) : null);
    const arr = (k: string) =>
      Array.isArray(data[k]) ? (data[k] as unknown[]).filter((x): x is string => typeof x === "string") : null;

    if (s("name")) set("name", s("name")!);
    if (s("primary") && ["ms", "en", "zh", "ta"].includes(s("primary")!))
      set("primary", s("primary") as Initial["primary"]);
    if (s("script") && ["latin", "jawi", "hans", "hant", "tamil"].includes(s("script")!))
      set("script", s("script") as Initial["script"]);
    if (
      s("codeSwitchPolicy") &&
      ["none", "inter-sentential", "intra-sentential", "rojak"].includes(s("codeSwitchPolicy")!)
    )
      set("codeSwitchPolicy", s("codeSwitchPolicy") as Initial["codeSwitchPolicy"]);
    if (n("codeSwitchRate") != null) set("codeSwitchRate", Math.max(0, Math.min(1, n("codeSwitchRate")!)));
    if (s("register") && ["formal", "semi-formal", "colloquial", "mixed"].includes(s("register")!))
      set("register", s("register") as Initial["register"]);
    if (b("allowParticles") != null) set("allowParticles", b("allowParticles")!);
    if (b("requireFormalMalay") != null) set("requireFormalMalay", b("requireFormalMalay")!);
    if (
      s("englishLoanwordPolicy") &&
      ["forbid", "allowlist", "free"].includes(s("englishLoanwordPolicy")!)
    )
      set(
        "englishLoanwordPolicy",
        s("englishLoanwordPolicy") as Initial["englishLoanwordPolicy"],
      );
    if (s("notes")) set("notes", s("notes"));

    if (arr("secondary")) setSecondaryText(arr("secondary")!.join(", "));
    if (arr("bannedTokens")) setBannedText(arr("bannedTokens")!.join(", "));
    if (arr("bannedPatterns")) setBannedPatternsText(arr("bannedPatterns")!.join(", "));
    if (arr("loanwordAllowlist")) setAllowText(arr("loanwordAllowlist")!.join(", "));
    if (arr("dialectHints")) setDialectText(arr("dialectHints")!.join(", "));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex justify-end">
        <AiAssistButton
          projectId={projectId}
          kind="language-profile"
          providers={providers}
          placeholder="An enterprise formal profile for customer-support data: ban colloquial particles and SMS shortcuts; allow domain loanwords (router, modem, bandwidth, etc.). Works for any locale — describe the language(s) and rules."
          onApply={applyAi}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="primary">Primary language</Label>
          <Select value={form.primary} onValueChange={(v) => set("primary", v as Initial["primary"])}>
            <SelectTrigger id="primary">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ms">Bahasa Melayu (ms)</SelectItem>
              <SelectItem value="en">English (en)</SelectItem>
              <SelectItem value="zh">中文 / Mandarin (zh)</SelectItem>
              <SelectItem value="ta">தமிழ் / Tamil (ta)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="script">Script</Label>
          <Select value={form.script} onValueChange={(v) => set("script", v as Initial["script"])}>
            <SelectTrigger id="script">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latin">Latin (Rumi)</SelectItem>
              <SelectItem value="jawi">Jawi (Arabic-script Malay)</SelectItem>
              <SelectItem value="hans">Simplified Chinese</SelectItem>
              <SelectItem value="hant">Traditional Chinese</SelectItem>
              <SelectItem value="tamil">Tamil script</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="secondary">Secondary languages (for code-switching)</Label>
          <Input
            id="secondary"
            placeholder="en, zh"
            value={secondaryText}
            onChange={(e) => setSecondaryText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Comma-separated. Choose from: {SECONDARY_OPTIONS.join(", ")}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="codeSwitchPolicy">Code-switch policy</Label>
          <Select
            value={form.codeSwitchPolicy}
            onValueChange={(v) => set("codeSwitchPolicy", v as Initial["codeSwitchPolicy"])}
          >
            <SelectTrigger id="codeSwitchPolicy">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None — pure primary language</SelectItem>
              <SelectItem value="inter-sentential">Inter-sentential — switch between sentences</SelectItem>
              <SelectItem value="intra-sentential">Intra-sentential — switch within sentences</SelectItem>
              <SelectItem value="rojak">Rojak — fully mixed (frequent intra-word/phrase switching)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="rate">Code-switch rate (0–1)</Label>
          <Input
            id="rate"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={form.codeSwitchRate ?? ""}
            onChange={(e) =>
              set(
                "codeSwitchRate",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
            placeholder="0.4"
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
        <div className="text-sm font-semibold">Formality lock</div>
        <p className="text-xs text-muted-foreground">
          The differentiator for enterprise datasets in any locale. Both the system-prompt style guide
          and the <code>register-compliance</code> validator enforce these.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="register">Register</Label>
            <Select value={form.register} onValueChange={(v) => set("register", v as Initial["register"])}>
              <SelectTrigger id="register">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="formal">Formal</SelectItem>
                <SelectItem value="semi-formal">Semi-formal</SelectItem>
                <SelectItem value="colloquial">Colloquial</SelectItem>
                <SelectItem value="mixed">Mixed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="allowParticles"
                checked={form.allowParticles}
                onCheckedChange={(v) => set("allowParticles", v)}
              />
              <Label htmlFor="allowParticles" className="cursor-pointer">
                Allow colloquial particles (e.g. Manglish lah/lor/meh, French quoi/bah, German halt/ja)
              </Label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="baku"
              checked={form.requireFormalMalay}
              onCheckedChange={(v) => set("requireFormalMalay", v)}
            />
            <Label htmlFor="baku" className="cursor-pointer">
              Require strict spelling (no SMS shortcuts — tak/je/dah/mcm for MS, tkt/svp for FR, lg/mfg for DE, etc.)
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="loan">English loanword policy</Label>
            <Select
              value={form.englishLoanwordPolicy}
              onValueChange={(v) =>
                set("englishLoanwordPolicy", v as Initial["englishLoanwordPolicy"])
              }
            >
              <SelectTrigger id="loan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free — any English allowed</SelectItem>
                <SelectItem value="allowlist">Allowlist — only listed words</SelectItem>
                <SelectItem value="forbid">Forbid — no English borrowings</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="banned">Banned tokens (one per line or comma-separated)</Label>
          <Textarea
            id="banned"
            value={bannedText}
            onChange={(e) => setBannedText(e.target.value)}
            placeholder="lah, lor, meh, kan, kot, wei, doh"
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            Validator hard-fails any conversation containing these (case-insensitive, word-bounded)
            when <code>allowParticles</code> is off.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="banned-patterns">Banned regex patterns (optional, one per line)</Label>
          <Textarea
            id="banned-patterns"
            value={bannedPatternsText}
            onChange={(e) => setBannedPatternsText(e.target.value)}
            placeholder="\\btq\\b, \\bbtw\\b"
            rows={2}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="loanlist">Loanword allowlist (when policy = allowlist)</Label>
          <Textarea
            id="loanlist"
            value={allowText}
            onChange={(e) => setAllowText(e.target.value)}
            placeholder="router, modem, bil, bandwidth, internet"
            rows={2}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="dialect">Dialect hints (optional)</Label>
        <Input
          id="dialect"
          value={dialectText}
          onChange={(e) => setDialectText(e.target.value)}
          placeholder="kelantan, manglish"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={form.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
          rows={2}
        />
      </div>

      <Button type="submit" disabled={pending}>
        <Save className="mr-2 h-4 w-4" />
        {pending ? "Saving…" : form.id ? "Save changes" : "Create profile"}
      </Button>
    </form>
  );
}
