"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Send, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { exportToLabelingPlatform } from "../../../actions";

// Dialog that exports the top-K% of a benchmark run's passing items to
// a human_mos project on the user's labeling platform. The labeling
// platform connection (base URL + bearer token) is configured ONCE per
// project under Settings → Labeling platform; this dialog uses those
// stored credentials and shows the destination URL so the user can
// confirm where their data is going before they hit Export.
//
// When the project doesn't have a labeling connection saved, the
// trigger button is disabled with a tooltip directing the user to
// Settings — the dialog itself never has to handle the missing-config
// case.
export function ExportToLabelingDialog({
  projectId,
  runId,
  benchmarkName,
  // Pulled from Project.labelingBaseUrl + boolean derived from
  // Project.labelingApiKeyEnc (the encrypted blob never leaves the
  // server, only the existence check).
  labelingBaseUrl,
  hasLabelingApiKey,
}: {
  projectId: string;
  runId: string;
  benchmarkName: string;
  labelingBaseUrl: string | null;
  hasLabelingApiKey: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [labelingProjectName, setLabelingProjectName] = useState("");
  const [percent, setPercent] = useState(1); // 1%
  // Default floor of 3 (not 4) — with the strict judge prompt, very
  // few responses get straight 5s, so 4 was filtering out almost
  // everything. 3 is a more workable starting point; users can crank
  // it higher with the slider.
  const [minAxisScore, setMinAxisScore] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    labelingProjectUrl: string;
    labelingProjectName: string;
    pickedCount: number;
    uploadedCount: number;
    totalPassing: number;
  } | null>(null);

  const configured = !!labelingBaseUrl && hasLabelingApiKey;
  const missingTooltip = !labelingBaseUrl
    ? "Labeling platform URL not set. Open Settings → Labeling platform to configure it."
    : !hasLabelingApiKey
      ? "Labeling platform API token not set. Open Settings → Labeling platform to configure it."
      : "";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    start(async () => {
      const res = await exportToLabelingPlatform({
        projectId,
        runId,
        // No URL/token in payload — server reads from project settings.
        labelingProjectName: labelingProjectName.trim() || undefined,
        percent: percent / 100,
        minAxisScore,
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if ("ok" in res && res.ok) {
        setResult({
          labelingProjectUrl: res.labelingProjectUrl,
          labelingProjectName: res.labelingProjectName,
          pickedCount: res.pickedCount,
          uploadedCount: res.uploadedCount,
          totalPassing: res.totalPassing,
        });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!configured}
          title={configured ? undefined : missingTooltip}
        >
          <Send className="mr-2 h-3.5 w-3.5" />
          Export top % to labeling
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export to labeling platform</DialogTitle>
          <DialogDescription>
            Stratified sample of the top conversations (by composite axis score,
            split × persona × taxonomy) sent as a <code>human_mos</code> project
            on the labeling platform for human spot-check.
          </DialogDescription>
        </DialogHeader>

        {/* Destination URL — always visible (form view AND result view)
            so the user knows where data went / is going to. */}
        {labelingBaseUrl && (
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-[11px]">
            <span className="text-muted-foreground">Destination: </span>
            <a
              href={labelingBaseUrl.replace(/\/$/, "")}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono hover:underline"
              title={labelingBaseUrl}
            >
              {labelingBaseUrl.replace(/\/$/, "")}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {result ? (
          <div className="space-y-3">
            <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
              Uploaded <span className="font-mono">{result.uploadedCount}</span>{" "}
              of {result.pickedCount} picked
              {result.totalPassing > result.pickedCount && (
                <> (from {result.totalPassing} passing candidates)</>
              )}
              .
            </p>
            <p className="text-xs">
              <span className="text-muted-foreground">Project:</span>{" "}
              <a
                href={result.labelingProjectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono hover:underline"
              >
                {result.labelingProjectName}
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
            <DialogFooter>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="lp-name">Labeling project name (optional)</Label>
              <Input
                id="lp-name"
                value={labelingProjectName}
                onChange={(e) => setLabelingProjectName(e.target.value)}
                placeholder={`${benchmarkName} · top ${percent}% · auto`}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="lp-pct">Top percent to export</Label>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {percent}%
                </span>
              </div>
              <Slider
                id="lp-pct"
                min={0.1}
                max={10}
                step={0.1}
                value={[percent]}
                onValueChange={([v]) => setPercent(v)}
              />
              <p className="text-[10px] text-muted-foreground">
                1% of 100k conversations ≈ 1,000 tasks for human review.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="lp-floor">Minimum per-axis score</Label>
                <span className="font-mono text-[11px] text-muted-foreground">
                  ≥ {minAxisScore}
                </span>
              </div>
              <Slider
                id="lp-floor"
                min={1}
                max={5}
                step={1}
                value={[minAxisScore]}
                onValueChange={([v]) => setMinAxisScore(v)}
              />
              <p className="text-[10px] text-muted-foreground">
                Any conversation with any axis below this is dropped before
                stratification. Higher = stricter quality bar.
              </p>
            </div>

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? (
                  <>
                    <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Exporting…
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-3.5 w-3.5" />
                    Export
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
