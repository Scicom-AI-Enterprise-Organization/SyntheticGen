"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
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
import { AiAssistButton } from "@/components/ai-assist-button";
import { createTemplate } from "./actions";

interface Provider {
  id: string;
  name: string;
  defaultModel: string | null;
}

const DEFAULT_USER_SEED = `A realistic customer-support inquiry for a telco operator.

Persona: {{persona.name}} ({{persona.region}}, {{persona.urbanity}}).
Topic: {{taxonomy.path}}.
Language: {{language.primary}}.
Difficulty: {{difficulty}}.

Write a single customer message in the persona's voice and language. Do NOT
include the operator's reply — just the customer's turn.`;

export function TemplateForm({
  projectId,
  providers,
  taxonomyNodes,
  existingTemplates,
  languageProfiles,
}: {
  projectId: string;
  providers: Provider[];
  taxonomyNodes?: string[];
  existingTemplates?: string[];
  languageProfiles?: string[];
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"system" | "user-seed" | "judge" | "conversation-driver">("user-seed");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState(DEFAULT_USER_SEED);
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
    if (s("body")) setBody(s("body")!);
    const k = s("kind");
    if (k && ["system", "user-seed", "judge", "conversation-driver"].includes(k)) {
      setKind(k as typeof kind);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    start(async () => {
      const res = await createTemplate({
        projectId,
        name,
        kind,
        description: description || null,
        body,
      });
      if ("error" in res && res.error) {
        setError(res.error);
      } else {
        setSuccess(`Template “${name}” created.`);
        setName("");
        setDescription("");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex justify-end">
        <AiAssistButton
          projectId={projectId}
          kind="prompt-template"
          providers={providers}
          placeholder="A user-seed template for telco customer-support inquiries about modem outages, in the project's primary language and formal register, that uses {{persona.name}} and {{taxonomy.path}}."
          onApply={applyAi}
          open={suggestOpen}
          onOpenChange={setSuggestOpen}
          randomizePrompt={{
            description:
              "Invent ONE concise prompt for an LLM to generate a PromptTemplate. Pick a kind (user-seed / system / judge / conversation-driver) and a domain (telco support, retail banking, hospital scheduling, government enquiries, e-commerce returns, etc.). Mention the formality register, primary language, code-switch behaviour if any, and which Mustache variables it should reference ({{persona.name}}, {{persona.region}}, {{persona.urbanity}}, {{taxonomy.path}}, {{language.primary}}, {{difficulty}}). ONE or TWO sentences — used as input to a downstream form-filling LLM.",
            context: [
              taxonomyNodes && taxonomyNodes.length > 0
                ? `Project taxonomy topics (pick one when relevant):\n${taxonomyNodes.map((t) => `- ${t}`).join("\n")}`
                : null,
              languageProfiles && languageProfiles.length > 0
                ? `Available language profiles in this project:\n${languageProfiles.map((p) => `- ${p}`).join("\n")}`
                : null,
              existingTemplates && existingTemplates.length > 0
                ? `Existing templates (avoid near-duplicates):\n${existingTemplates.map((t) => `- ${t}`).join("\n")}`
                : null,
            ]
              .filter(Boolean)
              .join("\n\n") || null,
          }}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <div className="space-y-2">
          <Label htmlFor="t-name">Name</Label>
          <Input
            id="t-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="TM Customer Inquiry — Single Turn"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user-seed">user-seed</SelectItem>
              <SelectItem value="system">system</SelectItem>
              <SelectItem value="conversation-driver">conversation-driver</SelectItem>
              <SelectItem value="judge">judge</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="t-desc">Description</Label>
        <Input
          id="t-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One line"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="t-body">Body</Label>
        <Textarea
          id="t-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          className="font-mono text-xs"
          required
        />
        <p className="text-xs text-muted-foreground">
          Mustache-style: <code>{"{{persona.name}}"}</code>, <code>{"{{persona.region}}"}</code>,{" "}
          <code>{"{{persona.urbanity}}"}</code>, <code>{"{{taxonomy.path}}"}</code>,{" "}
          <code>{"{{language.primary}}"}</code>, <code>{"{{difficulty}}"}</code>.
        </p>
      </div>

      <div className="space-y-2">
        <Button type="submit" disabled={pending}>
          <Plus className="mr-2 h-4 w-4" />
          {pending ? "Creating…" : "Create template"}
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
