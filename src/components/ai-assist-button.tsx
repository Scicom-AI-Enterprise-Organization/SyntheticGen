"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AiAssistKind } from "@/lib/synthgen-api";

interface ProviderOption {
  id: string;
  name: string;
  defaultModel: string | null;
}

export function AiAssistButton({
  projectId,
  kind,
  providers,
  placeholder,
  onApply,
  variant = "outline",
  size = "sm",
  buttonLabel = "Fill with AI",
}: {
  projectId: string;
  kind: AiAssistKind;
  providers: ProviderOption[];
  placeholder?: string;
  onApply: (data: Record<string, unknown>) => void;
  variant?: "outline" | "default" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [pending, start] = useTransition();

  function onRun() {
    if (!prompt.trim()) {
      toast.error("Describe what you want first.");
      return;
    }
    if (!providerId) {
      toast.error("No provider configured. Add one under Providers.");
      return;
    }
    start(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/ai-assist`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, prompt, providerId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `http ${res.status}`);
        }
        const json = (await res.json()) as { data: Record<string, unknown> };
        onApply(json.data ?? {});
        toast.success("Form filled — review the values before saving.");
        setOpen(false);
        setPrompt("");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  if (providers.length === 0) {
    return (
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled
        title="Add a Provider under the Providers tab to enable AI-assist"
      >
        <Sparkles className="mr-2 h-4 w-4" />
        {buttonLabel}
      </Button>
    );
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        <Sparkles className="mr-2 h-4 w-4" />
        {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              {buttonLabel}
            </DialogTitle>
            <DialogDescription>
              Describe what you want and the LLM will fill the form. Review the values before saving.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="ai-prompt">Prompt</Label>
              <Textarea
                id="ai-prompt"
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={placeholder ?? "Describe what you want…"}
                disabled={pending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-provider">Provider</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger id="ai-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.defaultModel && (
                        <span className="ml-1 text-muted-foreground">({p.defaultModel})</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={onRun} disabled={pending}>
              {pending ? "Generating…" : "Fill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
