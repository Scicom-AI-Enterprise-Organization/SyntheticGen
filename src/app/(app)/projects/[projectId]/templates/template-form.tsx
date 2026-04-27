"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
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

const DEFAULT_USER_SEED = `Soalan pelanggan untuk operator telco di Malaysia.

Persona: {{persona.name}} ({{persona.region}}, {{persona.urbanity}}).
Topik: {{taxonomy.path}}.
Bahasa: {{language.primary}}.
Tahap kesukaran: {{difficulty}}.

Tulis hanya satu soalan pelanggan yang realistik. Jangan termasuk jawapan operator.`;

export function TemplateForm({
  projectId,
  providers,
}: {
  projectId: string;
  providers: Provider[];
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"system" | "user-seed" | "judge" | "conversation-driver">("user-seed");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState(DEFAULT_USER_SEED);
  const [pending, start] = useTransition();

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
    start(async () => {
      const res = await createTemplate({
        projectId,
        name,
        kind,
        description: description || null,
        body,
      });
      if ("error" in res && res.error) toast.error(res.error);
      else {
        toast.success("Template created");
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
          placeholder="A user-seed template for telco customer-support inquiries about modem outages, in Formal Malay, that uses {{persona.name}} and {{taxonomy.path}}."
          onApply={applyAi}
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

      <Button type="submit" disabled={pending}>
        <Plus className="mr-2 h-4 w-4" />
        {pending ? "Creating…" : "Create template"}
      </Button>
    </form>
  );
}
