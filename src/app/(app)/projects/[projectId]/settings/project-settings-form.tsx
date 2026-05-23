"use client";

import { useState, useTransition } from "react";
import { Save, Plug, RefreshCw, Check, X } from "lucide-react";
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
import { updateProject, testLabelingConnection } from "../../actions";

interface Project {
  id: string;
  name: string;
  description: string | null;
  defaultFormality: string;
  labelingBaseUrl: string | null;
  hasLabelingApiKey: boolean;
}

export function ProjectSettingsForm({
  project,
  disabled,
}: {
  project: Project;
  disabled: boolean;
}) {
  // General card state
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [defaultFormality, setDefaultFormality] = useState(project.defaultFormality);
  const [savingGeneral, startGeneral] = useTransition();
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [generalSuccess, setGeneralSuccess] = useState<string | null>(null);

  // Labeling platform card state — completely separate so saving one
  // card doesn't accidentally touch fields from the other.
  const [labelingBaseUrl, setLabelingBaseUrl] = useState(project.labelingBaseUrl ?? "");
  const [labelingApiKey, setLabelingApiKey] = useState("");
  const [savingLabeling, startLabeling] = useTransition();
  const [labelingError, setLabelingError] = useState<string | null>(null);
  const [labelingSuccess, setLabelingSuccess] = useState<string | null>(null);
  const [testing, startTest] = useTransition();
  const [testResult, setTestResult] = useState<
    | { ok: true; message: string }
    | { ok: false; error: string }
    | null
  >(null);

  // Editing either field invalidates the most recent test — force a
  // re-test before save so we never persist credentials that haven't
  // been verified.
  function onLabelingUrlChange(v: string) {
    setLabelingBaseUrl(v);
    if (testResult) setTestResult(null);
  }
  function onLabelingKeyChange(v: string) {
    setLabelingApiKey(v);
    if (testResult) setTestResult(null);
  }

  // Save is gated on a passing test EXCEPT when the user is clearing
  // the connection entirely (URL empty AND no stored / typed token) —
  // in that case there's nothing to test, just persist the removal.
  const labelingDirtyCleared =
    labelingBaseUrl.trim() === "" &&
    labelingApiKey === "" &&
    !project.hasLabelingApiKey;
  const canSaveLabeling = labelingDirtyCleared || testResult?.ok === true;

  function saveGeneral() {
    setGeneralError(null);
    setGeneralSuccess(null);
    startGeneral(async () => {
      const res = await updateProject({
        projectId: project.id,
        name,
        description: description || undefined,
        defaultFormality: defaultFormality as "formal" | "semi-formal" | "colloquial" | "mixed",
      });
      if ("error" in res && res.error) {
        setGeneralError(res.error);
      } else {
        setGeneralSuccess("Saved.");
      }
    });
  }

  function saveLabeling() {
    setLabelingError(null);
    setLabelingSuccess(null);
    startLabeling(async () => {
      const res = await updateProject({
        projectId: project.id,
        labelingBaseUrl,
        // Only send the token if the user typed one; empty means "keep
        // the existing encrypted token".
        ...(labelingApiKey.length > 0 ? { labelingApiKey } : {}),
      });
      if ("error" in res && res.error) {
        setLabelingError(res.error);
      } else {
        setLabelingSuccess("Saved.");
        setLabelingApiKey("");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* ─── General ───────────────────────────────────────────── */}
      <div className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>Name, description, default formality.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={disabled || savingGeneral}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="default-formality">Default formality</Label>
                <Select
                  value={defaultFormality}
                  onValueChange={setDefaultFormality}
                  disabled={disabled || savingGeneral}
                >
                  <SelectTrigger id="default-formality" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="formal">Formal</SelectItem>
                    <SelectItem value="semi-formal">Semi-formal</SelectItem>
                    <SelectItem value="colloquial">Colloquial</SelectItem>
                    <SelectItem value="mixed">Mixed</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Falls through to LanguageProfile / Persona / Run overrides. Changing this only affects new
                  runs that resolve formality from the project default.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={disabled || savingGeneral}
              />
            </div>
          </CardContent>
        </Card>

        {/* General card save button — outside the card per the /new
            page convention so the action is visually distinct from the
            inputs it commits. */}
        <div className="flex items-center justify-end gap-3">
          {generalError && (
            <span
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive"
              role="alert"
            >
              {generalError}
            </span>
          )}
          {generalSuccess && (
            <span className="text-xs text-green-600" role="status">
              {generalSuccess}
            </span>
          )}
          <Button
            type="button"
            disabled={disabled || savingGeneral}
            onClick={saveGeneral}
          >
            <Save className="mr-2 h-4 w-4" />
            {savingGeneral ? "Saving…" : "Save general"}
          </Button>
        </div>
      </div>

      {/* ─── Labeling platform ─────────────────────────────────── */}
      <div className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>Labeling platform</CardTitle>
            <CardDescription>
              Connection used by the &quot;Export top % to labeling&quot; flow on
              benchmark runs. Stored once here so users don&apos;t retype the
              token per export. The token is encrypted at rest.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="labeling-url">Base URL</Label>
                <Input
                  id="labeling-url"
                  value={labelingBaseUrl}
                  onChange={(e) => onLabelingUrlChange(e.target.value)}
                  placeholder="http://localhost:3002"
                  disabled={disabled || savingLabeling}
                />
                <p className="text-[10px] text-muted-foreground">
                  Empty to clear.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="labeling-key">API token</Label>
                <Input
                  id="labeling-key"
                  type="password"
                  value={labelingApiKey}
                  onChange={(e) => onLabelingKeyChange(e.target.value)}
                  placeholder={
                    project.hasLabelingApiKey
                      ? "•••••• (saved — type to replace)"
                      : "lpat_…"
                  }
                  disabled={disabled || savingLabeling}
                />
                <p className="text-[10px] text-muted-foreground">
                  Get one from{" "}
                  <code>/dashboard/user → API Tokens</code> on the labeling
                  platform. Leave blank to keep the existing token.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Test + Save outside the card, in a single row. Test uses
            whichever credentials are about to be saved (typed
            overrides → stored fallback). */}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {testResult && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] ${
                testResult.ok
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-destructive"
              }`}
            >
              {testResult.ok ? (
                <Check className="h-3 w-3" />
              ) : (
                <X className="h-3 w-3" />
              )}
              <span
                className="max-w-[420px] truncate"
                title={testResult.ok ? testResult.message : testResult.error}
              >
                {testResult.ok ? testResult.message : testResult.error}
              </span>
            </span>
          )}
          {labelingError && (
            <span
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive"
              role="alert"
            >
              {labelingError}
            </span>
          )}
          {labelingSuccess && (
            <span className="text-xs text-green-600" role="status">
              {labelingSuccess}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={disabled || testing || savingLabeling}
            onClick={() => {
              setTestResult(null);
              startTest(async () => {
                const res = await testLabelingConnection({
                  projectId: project.id,
                  labelingBaseUrl,
                  ...(labelingApiKey.length > 0 ? { labelingApiKey } : {}),
                });
                setTestResult(res);
              });
            }}
          >
            {testing ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plug className="mr-2 h-4 w-4" />
            )}
            {testing ? "Testing…" : "Test connection"}
          </Button>
          <Button
            type="button"
            disabled={disabled || savingLabeling || !canSaveLabeling}
            onClick={saveLabeling}
            title={
              canSaveLabeling
                ? undefined
                : "Run Test connection first — a passing test is required before saving."
            }
          >
            <Save className="mr-2 h-4 w-4" />
            {savingLabeling ? "Saving…" : "Save labeling"}
          </Button>
        </div>
      </div>
    </div>
  );
}
