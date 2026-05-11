"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, AlertTriangle } from "lucide-react";
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
import { createPersona } from "./actions";

const NONE = "__none__";

interface LP {
  id: string;
  name: string;
  register: string;
  allowParticles: boolean;
}

interface Provider {
  id: string;
  name: string;
  defaultModel: string | null;
}

const ETHNICITIES = ["malay", "chinese", "indian", "iban", "kadazan", "orang-asli", "mixed", "other"];
const REGIONS = [
  "kl", "selangor", "penang", "johor", "kelantan", "terengganu",
  "kedah", "perak", "melaka", "negeri-sembilan", "pahang", "perlis",
  "sabah", "sarawak", "putrajaya", "labuan",
];
const AGE_RANGES = ["13-17", "18-24", "25-34", "35-49", "50-64", "65+"];

export function PersonaForm({
  projectId,
  languageProfiles,
  providers,
  taxonomyNodes,
}: {
  projectId: string;
  languageProfiles: LP[];
  providers: Provider[];
  taxonomyNodes?: string[];
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ethnicity, setEthnicity] = useState(NONE);
  const [region, setRegion] = useState(NONE);
  const [urbanity, setUrbanity] = useState(NONE);
  const [ageRange, setAgeRange] = useState(NONE);
  const [formality, setFormality] = useState(NONE);
  const [religionAware, setReligionAware] = useState(false);
  const [dialectTags, setDialectTags] = useState("");
  const [languageProfileId, setLanguageProfileId] = useState(NONE);
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

  const selectedLP = languageProfiles.find((p) => p.id === languageProfileId) ?? null;

  // Conflict warning: persona declares colloquial/manglish but LP forbids particles.
  const conflict = useMemo(() => {
    if (!selectedLP) return null;
    const personaIsColloquial = formality === "colloquial" || formality === "manglish";
    if (personaIsColloquial && !selectedLP.allowParticles) {
      return `Persona formality "${formality}" expects Manglish, but the language profile "${selectedLP.name}" bans particles. The validator will reject most outputs.`;
    }
    if (formality === "baku" && selectedLP.allowParticles) {
      return `Persona is set to a formal register but the language profile permits colloquial particles — outputs may drift colloquial.`;
    }
    return null;
  }, [selectedLP, formality]);

  function unwrap(v: string) {
    return v === NONE ? null : v;
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await createPersona({
        projectId,
        name,
        description: description || null,
        ethnicity: unwrap(ethnicity),
        region: unwrap(region),
        urbanity: unwrap(urbanity) as "urban" | "suburban" | "kampung" | null,
        ageRange: unwrap(ageRange),
        gender: null,
        occupation: null,
        formality: unwrap(formality) as "baku" | "colloquial" | "manglish" | "mixed" | null,
        religionAware,
        dialectTags: dialectTags
          .split(/[,\n]+/)
          .map((s) => s.trim())
          .filter(Boolean),
        languageProfileId: unwrap(languageProfileId),
      });
      if ("error" in res && res.error) toast.error(res.error);
      else {
        toast.success("Persona created");
        setName("");
        setDescription("");
        setDialectTags("");
      }
    });
  }

  function applyAi(data: Record<string, unknown>) {
    const s = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null);
    if (s("name")) setName(s("name")!);
    if (s("description")) setDescription(s("description")!);
    if (s("ethnicity") && ETHNICITIES.includes(s("ethnicity")!)) setEthnicity(s("ethnicity")!);
    if (s("region") && REGIONS.includes(s("region")!)) setRegion(s("region")!);
    if (s("urbanity") && ["urban", "suburban", "kampung"].includes(s("urbanity")!))
      setUrbanity(s("urbanity")!);
    if (s("ageRange") && AGE_RANGES.includes(s("ageRange")!)) setAgeRange(s("ageRange")!);
    if (s("formality") && ["baku", "colloquial", "manglish", "mixed"].includes(s("formality")!))
      setFormality(s("formality")!);
    if (typeof data["religionAware"] === "boolean") setReligionAware(data["religionAware"] as boolean);
    if (Array.isArray(data["dialectTags"])) {
      setDialectTags(
        (data["dialectTags"] as unknown[]).filter((x): x is string => typeof x === "string").join(", "),
      );
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex justify-end">
        <AiAssistButton
          projectId={projectId}
          kind="persona"
          providers={providers}
          placeholder="A 32-year-old retail bank customer in Lyon who switches FR↔EN; or a Manchester telco subscriber on prepaid; or any locale-specific persona you need."
          onApply={applyAi}
          open={suggestOpen}
          onOpenChange={setSuggestOpen}
          randomizePrompt={{
            description:
              "Invent ONE concise persona for a Malaysia-focused synthetic-data project. Vary demographics each call (age, ethnicity — malay/chinese/indian/iban/kadazan/orang-asli/mixed, region — KL/Selangor/Penang/Johor/Kelantan/Sabah/Sarawak/etc., urbanity, formality — baku/colloquial/manglish). Include a specific need or topic the persona is contacting customer support about, plus their preferred language register and any code-switch behaviour. ONE or TWO sentences only — this text will be used as the prompt to a downstream form-filling LLM.",
            context:
              taxonomyNodes && taxonomyNodes.length > 0
                ? `Pick the topic (or related topic) from this project's taxonomy:\n${taxonomyNodes.map((n) => `- ${n}`).join("\n")}`
                : null,
          }}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="p-name">Name</Label>
          <Input
            id="p-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Lyon retail-bank customer, KL telco retiree"
            required
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="p-desc">Description</Label>
          <Textarea
            id="p-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>

        <div className="space-y-2">
          <Label>Ethnicity</Label>
          <Select value={ethnicity} onValueChange={setEthnicity}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {ETHNICITIES.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Region</Label>
          <Select value={region} onValueChange={setRegion}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {REGIONS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Urbanity</Label>
          <Select value={urbanity} onValueChange={setUrbanity}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              <SelectItem value="urban">urban</SelectItem>
              <SelectItem value="suburban">suburban</SelectItem>
              <SelectItem value="kampung">kampung</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Age range</Label>
          <Select value={ageRange} onValueChange={setAgeRange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {AGE_RANGES.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Formality</Label>
          <Select value={formality} onValueChange={setFormality}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              <SelectItem value="baku">Baku (formal)</SelectItem>
              <SelectItem value="colloquial">Colloquial</SelectItem>
              <SelectItem value="manglish">Manglish</SelectItem>
              <SelectItem value="mixed">Mixed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Default language profile</Label>
          <Select value={languageProfileId} onValueChange={setLanguageProfileId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {languageProfiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 sm:col-span-2">
          <Switch
            id="religion-aware"
            checked={religionAware}
            onCheckedChange={setReligionAware}
          />
          <Label htmlFor="religion-aware" className="cursor-pointer">
            Religion-aware (gates halal / prayer-time content)
          </Label>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="p-dialect">Dialect tags (comma-separated)</Label>
          <Input
            id="p-dialect"
            value={dialectTags}
            onChange={(e) => setDialectTags(e.target.value)}
            placeholder="kelantan, manglish"
          />
        </div>
      </div>

      {conflict && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{conflict}</p>
        </div>
      )}

      <Button type="submit" disabled={pending}>
        <Plus className="mr-2 h-4 w-4" />
        {pending ? "Creating…" : "Create persona"}
      </Button>
    </form>
  );
}
