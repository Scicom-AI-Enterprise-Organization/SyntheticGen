"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  Trash2,
  X,
  AlertCircle,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThroughputBadge } from "@/components/throughput-badge";
import { useStickyBottom } from "@/lib/use-sticky-bottom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  cancelBootstrap,
  deleteJobGenerations,
  getFailedSteps,
  rerunBootstrap,
  summarizeJobGenerations,
} from "./actions";

interface JobInitial {
  id: string;
  projectId: string;
  prompt: string;
  status: string;
  currentStep: string | null;
  scope: Record<string, boolean>;
  events: BootstrapEvent[];
  inserted: Record<string, number>;
  // Snapshot of the most recently committed phase output (or null if no
  // phase has finished yet). Now persisted only at phase-end — refreshing
  // mid-stream won't show in-flight tokens, but it WILL show whatever the
  // previous AI call produced, with its terminal state attached.
  currentPhaseBuffer: {
    step: string;
    phaseIndex: number;
    text: string;
    state?: "done" | "error";
    error?: string;
  } | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface BootstrapEvent {
  idx: number;
  ts: string;
  step: string;
  kind: string;
  payload?: Record<string, unknown>;
}

interface TokenEvent {
  step: string;
  phaseIndex: number;
  kind: "delta" | "phase-start" | "phase-end" | "retry";
  content?: string;
  meta?: Record<string, unknown>;
}

const STEPS = [
  { key: "taxonomy", label: "Taxonomy" },
  { key: "languages", label: "Language profiles" },
  { key: "personas", label: "Personas" },
  { key: "templates", label: "Templates" },
  { key: "tools", label: "Tools" },
  { key: "flows", label: "Flows" },
  { key: "rubrics", label: "Rubrics" },
  { key: "benchmarks", label: "Benchmarks" },
] as const;

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function stepStateFrom(
  step: string,
  events: BootstrapEvent[],
  currentStep: string | null,
  jobStatus: string,
): "pending" | "running" | "done" | "error" | "skipped" | "interrupted" {
  let started = false;
  let done = false;
  let errored = false;
  for (const e of events) {
    if (e.step !== step) continue;
    if (e.kind === "step-start") started = true;
    if (e.kind === "step-done") done = true;
    if (e.kind === "step-error") errored = true;
  }
  // Once the job is terminal, an in-flight step never completes — treat it
  // as interrupted so the UI stops spinning a Loader2 forever after cancel.
  const terminal = isTerminal(jobStatus);
  if (done) return errored ? "error" : "done";
  if (started || currentStep === step) {
    return terminal ? "interrupted" : "running";
  }
  return "pending";
}

export function JobView({ initial }: { initial: JobInitial }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial.status);
  const [currentStep, setCurrentStep] = useState(initial.currentStep);
  const [events, setEvents] = useState<BootstrapEvent[]>(initial.events);
  const [inserted, setInserted] = useState(initial.inserted);
  const [error, setError] = useState(initial.error);
  const [completedAt, setCompletedAt] = useState(initial.completedAt);

  // Live agent panel — token deltas from the in-memory bus. Cleared each time
  // a new AI call starts (phase-start) so the user sees only the in-flight
  // generation, not the full transcript.
  //
  // Seeded from the persisted phase buffer when one exists, so a page refresh
  // mid-stream picks up where the orchestrator left off instead of going
  // blank until the next delta lands.
  const [tokenStream, setTokenStream] = useState<{
    step: string;
    phaseIndex: number;
    text: string;
    state: "streaming" | "done" | "error";
    error?: string;
    // ms epoch when phase-start arrived. Drives the live tok/s meter so the
    // user can tell how fast the model is currently generating. Cleared on
    // phase-end; persisted-buffer seeds use null since the elapsed time is
    // unknown after a reload.
    startedAt: number | null;
  } | null>(
    initial.currentPhaseBuffer
      ? {
          step: initial.currentPhaseBuffer.step,
          phaseIndex: initial.currentPhaseBuffer.phaseIndex,
          text: initial.currentPhaseBuffer.text,
          // Buffer is committed only at phase-end, so it always has a final
          // state. Default to "done" if older rows didn't store it.
          state: initial.currentPhaseBuffer.state ?? "done",
          error: initial.currentPhaseBuffer.error,
          startedAt: null,
        }
      : null,
  );
  const [cancelling, startCancel] = useTransition();

  // Rerun-with-same-config state. `failedSteps` is null until we've
  // queried the server for the list of failed steps (used to label the
  // "Rerun failed only" menu item with a count). Re-queried on mount and
  // whenever the events list grows.
  const [rerunning, startRerun] = useTransition();
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [failedSteps, setFailedSteps] = useState<string[] | null>(null);

  // Delete-generations dialog state.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCounts, setDeleteCounts] = useState<Record<string, number> | null>(
    null,
  );
  const [deleteMissingIds, setDeleteMissingIds] = useState(0);
  const [deleteSummaryError, setDeleteSummaryError] = useState<string | null>(
    null,
  );
  const [alsoDeleteJob, setAlsoDeleteJob] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{
    removed: Record<string, number>;
    deletedJob: boolean;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  const lastRefresh = useRef(0);

  // Refresh the list of failed steps whenever the job reaches a terminal
  // state or its events grow. Used to label the "Rerun failed only"
  // dropdown item with an accurate count.
  useEffect(() => {
    if (!isTerminal(status)) {
      setFailedSteps(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await getFailedSteps(initial.projectId, initial.id);
      if (cancelled) return;
      if ("ok" in res) setFailedSteps(res.steps);
      else setFailedSteps([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, events.length, initial.projectId, initial.id]);

  // Subscribe to the SSE stream. Replays from current event count so a
  // navigate-away-then-back picks up cleanly.
  useEffect(() => {
    if (isTerminal(initial.status)) return;
    const since = events.length;
    const url = `/api/projects/${initial.projectId}/bootstrap/${initial.id}/stream?since=${since}`;
    const es = new EventSource(url);

    es.addEventListener("event", (e) => {
      try {
        const evt = JSON.parse((e as MessageEvent).data) as BootstrapEvent;
        setEvents((cur) => (cur.find((c) => c.idx === evt.idx) ? cur : [...cur, evt]));
      } catch {
        // ignore
      }
    });
    es.addEventListener("status", (e) => {
      try {
        const s = JSON.parse((e as MessageEvent).data) as {
          status: string;
          currentStep: string | null;
          inserted: Record<string, number>;
          error: string | null;
          completedAt: string | null;
        };
        setStatus(s.status);
        setCurrentStep(s.currentStep);
        setInserted(s.inserted ?? {});
        setError(s.error);
        setCompletedAt(s.completedAt);

        // Trickle-refresh sidebars/counts as new entities land. Avoid hammering
        // — throttle to one router.refresh() every 4s.
        const now = Date.now();
        if (now - lastRefresh.current > 4000) {
          lastRefresh.current = now;
          router.refresh();
        }
      } catch {
        // ignore
      }
    });
    es.addEventListener("token", (e) => {
      try {
        const t = JSON.parse((e as MessageEvent).data) as TokenEvent;
        setTokenStream((cur) => {
          if (t.kind === "phase-start") {
            return {
              step: t.step,
              phaseIndex: t.phaseIndex,
              text: "",
              state: "streaming",
              startedAt: Date.now(),
            };
          }
          if (t.kind === "delta") {
            // If we missed phase-start (race on reconnect), open a fresh
            // panel on the first delta we see — and stamp startedAt now so
            // the rate reflects only the in-session generation, not stale
            // pre-reconnect time.
            if (
              !cur ||
              cur.step !== t.step ||
              cur.phaseIndex !== t.phaseIndex
            ) {
              return {
                step: t.step,
                phaseIndex: t.phaseIndex,
                text: t.content ?? "",
                state: "streaming",
                startedAt: Date.now(),
              };
            }
            return { ...cur, text: cur.text + (t.content ?? "") };
          }
          if (t.kind === "retry") {
            // Server-side retry — wipe the current phase buffer so the
            // user doesn't see two interleaved attempts. Keep the panel
            // open in streaming state with a small "retry N/N" badge in
            // the text, which gets overwritten by the next delta.
            if (
              !cur ||
              cur.step !== t.step ||
              cur.phaseIndex !== t.phaseIndex
            ) {
              return cur;
            }
            const attempt =
              t.meta && typeof t.meta.attempt === "number"
                ? t.meta.attempt
                : null;
            const of =
              t.meta && typeof t.meta.of === "number" ? t.meta.of : null;
            const prev =
              t.meta && typeof t.meta.previousError === "string"
                ? t.meta.previousError
                : "";
            const banner =
              attempt && of
                ? `[retry ${attempt}/${of}${prev ? ` — ${prev}` : ""}]\n\n`
                : "[retry]\n\n";
            return {
              ...cur,
              text: banner,
              state: "streaming",
              startedAt: Date.now(),
            };
          }
          if (t.kind === "phase-end") {
            if (
              !cur ||
              cur.step !== t.step ||
              cur.phaseIndex !== t.phaseIndex
            ) {
              return cur;
            }
            const err =
              t.meta && typeof t.meta.error === "string"
                ? t.meta.error
                : undefined;
            return { ...cur, state: err ? "error" : "done", error: err };
          }
          return cur;
        });
      } catch {
        // ignore
      }
    });
    es.addEventListener("close", () => {
      es.close();
      setTokenStream(null);
      // Final refresh so the project counts reflect everything that landed.
      router.refresh();
    });
    es.onerror = () => {
      // EventSource will auto-reconnect on transient errors.
    };
    return () => {
      es.close();
    };
    // We only want to open the stream once per component mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id, initial.projectId]);

  // Auto-scroll the event log only if the user is already near the bottom.
  // The useStickyBottom hook takes care of the "leave them alone if they
  // scrolled up" logic so we don't fight a user mid-scroll.
  const eventsLogRef = useStickyBottom<HTMLDivElement>([events.length]);

  const activeSteps = STEPS.filter((s) => initial.scope[s.key]);
  const running = !isTerminal(status);

  function onCancel() {
    startCancel(async () => {
      await cancelBootstrap(initial.projectId, initial.id);
      // The bootstrap page's "no ?jobId" branch only finds non-terminal
      // jobs, so a router.refresh() after cancel would fall through to the
      // start form. Anchor the URL to ?jobId=<this job> so the page query
      // resolves through the explicit-jobId branch and stays on the
      // JobView (now showing status="cancelled").
      router.replace(
        `/projects/${initial.projectId}/bootstrap?jobId=${initial.id}`,
      );
      router.refresh();
    });
  }

  // "Start another" reruns the same bootstrap config (prompt + provider +
  // scope) as a NEW job rather than dropping the user on the start form.
  // Clicking the button on the bare /bootstrap page (no job loaded) is
  // handled separately on the StartForm — that's the "fresh prompt" path.
  // When `onlyFailed` is true, the new job only re-runs the phases that
  // failed (errored or didn't reach step-done) in this run.
  function onRestart(onlyFailed: boolean = false) {
    setRerunError(null);
    startRerun(async () => {
      const res = await rerunBootstrap(initial.projectId, initial.id, {
        onlyFailed,
      });
      if ("error" in res && res.error) {
        setRerunError(res.error);
        if (
          "runningJobId" in res &&
          typeof res.runningJobId === "string"
        ) {
          router.push(
            `/projects/${initial.projectId}/bootstrap?jobId=${res.runningJobId}`,
          );
        }
        return;
      }
      if (res.ok) {
        router.push(
          `/projects/${initial.projectId}/bootstrap?jobId=${res.id}`,
        );
      }
    });
  }

  // Lets the user bail back to the bare /bootstrap landing if they actually
  // want to start a fresh prompt instead of a rerun.
  function onNewPrompt() {
    router.push(`/projects/${initial.projectId}/bootstrap`);
  }

  function openDelete() {
    setDeleteCounts(null);
    setDeleteSummaryError(null);
    setDeleteResult(null);
    setDeleteError(null);
    setAlsoDeleteJob(false);
    setDeleteOpen(true);
    // Fetch the summary so the dialog shows accurate counts. We do this
    // through a transition so the dialog can render its loader while the
    // summary call is in flight.
    startDelete(async () => {
      const res = await summarizeJobGenerations(
        initial.projectId,
        initial.id,
      );
      if ("error" in res) {
        setDeleteSummaryError(res.error);
        return;
      }
      setDeleteCounts(res.counts);
      setDeleteMissingIds(res.missingIds);
    });
  }

  function confirmDelete() {
    startDelete(async () => {
      const res = await deleteJobGenerations(
        initial.projectId,
        initial.id,
        { deleteJobRow: alsoDeleteJob },
      );
      if ("error" in res && res.error) {
        setDeleteError(res.error);
        return;
      }
      if (res.ok) {
        setDeleteResult({
          removed: res.removed,
          deletedJob: alsoDeleteJob,
        });
        // Refresh sidebar counts.
        router.refresh();
        // If we also nuked the row, the page will fall back to the start form
        // on the next navigation. Send the user back to /bootstrap so it
        // re-resolves cleanly.
        if (alsoDeleteJob) {
          setTimeout(() => {
            router.push(`/projects/${initial.projectId}/bootstrap`);
          }, 1200);
        }
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Bootstrap
                <StatusBadge status={status} currentStep={currentStep} />
              </CardTitle>
              <CardDescription className="mt-1 whitespace-pre-wrap break-words">
                {initial.prompt}
              </CardDescription>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {running ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCancel}
                  disabled={cancelling}
                >
                  {cancelling ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <X className="mr-1 h-3 w-3" />
                  )}
                  Cancel
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onNewPrompt}
                    disabled={rerunning}
                  >
                    <Sparkles className="mr-1 h-3 w-3" />
                    New prompt
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={rerunning}
                        title="Rerun this bootstrap"
                      >
                        {rerunning ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCw className="mr-1 h-3 w-3" />
                        )}
                        Rerun
                        <ChevronDown className="ml-1 h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                        Run again with the same prompt + provider
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onRestart(false)}
                        disabled={rerunning}
                      >
                        <RotateCw className="mr-2 h-3.5 w-3.5" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-sm">Rerun everything</span>
                          <span className="text-[11px] text-muted-foreground">
                            Re-runs every in-scope phase from scratch.
                            Adds new entities alongside the existing ones.
                          </span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onRestart(true)}
                        disabled={
                          rerunning ||
                          failedSteps === null ||
                          failedSteps.length === 0
                        }
                      >
                        <AlertCircle className="mr-2 h-3.5 w-3.5" />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-sm">
                            Rerun failed only
                            {failedSteps && failedSteps.length > 0 && (
                              <span className="ml-1 text-muted-foreground">
                                ({failedSteps.length})
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {failedSteps === null
                              ? "Checking…"
                              : failedSteps.length === 0
                                ? "No failed phases to retry."
                                : `Re-runs: ${failedSteps.join(", ")}`}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={openDelete}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Delete generations
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="space-y-2">
            {activeSteps.map((s) => {
              const state = stepStateFrom(s.key, events, currentStep, status);
              const count = inserted[s.key] ?? 0;
              return (
                <li key={s.key} className="flex items-center gap-3 text-sm">
                  <StateIcon state={state} />
                  <span
                    className={
                      state === "pending"
                        ? "text-muted-foreground"
                        : "text-foreground"
                    }
                  >
                    {s.label}
                  </span>
                  {count > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {count} inserted
                    </Badge>
                  )}
                  {state === "running" && (
                    <span className="text-[11px] text-muted-foreground">
                      …generating
                    </span>
                  )}
                  {state === "interrupted" && (
                    <span className="text-[11px] text-muted-foreground">
                      interrupted
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="whitespace-pre-wrap break-words">{error}</span>
            </div>
          )}

          {rerunError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="whitespace-pre-wrap break-words">{rerunError}</span>
            </div>
          )}

          {status === "completed" && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
              Done {completedAt ? `· ${new Date(completedAt).toLocaleString()}` : ""}.
              All entities are saved to the project — open Personas, Languages,
              Templates, Flows, Tools, or Rubrics to review and tweak them.
            </div>
          )}
        </CardContent>
      </Card>

      {tokenStream && <LiveAgentPanel stream={tokenStream} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live log ({events.length})</CardTitle>
          <CardDescription>
            Streaming from the orchestrator. Safe to navigate away — the job
            keeps running and this view picks up from where it left off when
            you come back.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            ref={eventsLogRef}
            className="max-h-[480px] space-y-1 overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-[11px] leading-snug"
          >
            {events.length === 0 ? (
              <div className="text-muted-foreground">Waiting for the orchestrator…</div>
            ) : (
              events.map((e) => <EventRow key={e.idx} evt={e} />)
            )}
          </div>
        </CardContent>
      </Card>

      <DeleteGenerationsDialog
        open={deleteOpen}
        onOpenChange={(o) => {
          if (!o && !deleting) setDeleteOpen(o);
        }}
        loading={deleting}
        counts={deleteCounts}
        missingIds={deleteMissingIds}
        summaryError={deleteSummaryError}
        alsoDeleteJob={alsoDeleteJob}
        onAlsoDeleteJobChange={setAlsoDeleteJob}
        result={deleteResult}
        error={deleteError}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

const STEP_LABELS: Record<string, string> = {
  taxonomy: "Taxonomy nodes",
  languages: "Language profiles",
  personas: "Personas",
  templates: "Templates",
  tools: "Tools",
  flows: "Flows",
  rubrics: "Rubrics",
  benchmarks: "Benchmarks",
};

function DeleteGenerationsDialog({
  open,
  onOpenChange,
  loading,
  counts,
  missingIds,
  summaryError,
  alsoDeleteJob,
  onAlsoDeleteJobChange,
  result,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  counts: Record<string, number> | null;
  missingIds: number;
  summaryError: string | null;
  alsoDeleteJob: boolean;
  onAlsoDeleteJobChange: (v: boolean) => void;
  result: { removed: Record<string, number>; deletedJob: boolean } | null;
  error: string | null;
  onConfirm: () => void;
}) {
  const total =
    counts != null
      ? Object.values(counts).reduce((a, b) => a + b, 0)
      : null;
  const hasAnything = total != null && total > 0;
  const showSummary = !result;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            {result ? "Generations removed" : "Delete generations?"}
          </DialogTitle>
          <DialogDescription>
            {result
              ? "The selected entities have been removed from the project."
              : "Removes every entity this bootstrap job inserted. Items you've edited keep your changes — they're identified by their original IDs. Anything you've manually deleted is skipped silently."}
          </DialogDescription>
        </DialogHeader>

        {showSummary && (
          <div className="space-y-3 text-sm">
            {summaryError ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{summaryError}</span>
              </div>
            ) : counts == null ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Counting what would be removed…
              </div>
            ) : !hasAnything ? (
              <p className="text-muted-foreground">
                This job didn&apos;t insert anything (or all of its IDs predate
                the new tracking). Nothing to remove.
              </p>
            ) : (
              <>
                <ul className="space-y-1 rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-xs">
                  {Object.entries(counts)
                    .filter(([, n]) => n > 0)
                    .map(([step, n]) => (
                      <li key={step} className="flex justify-between">
                        <span>{STEP_LABELS[step] ?? step}</span>
                        <span className="text-muted-foreground">{n}</span>
                      </li>
                    ))}
                </ul>
                {missingIds > 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">
                    Note: {missingIds} older inserted event{missingIds === 1 ? "" : "s"}{" "}
                    don&apos;t carry entity IDs; those rows can&apos;t be
                    auto-removed and will need manual cleanup.
                  </p>
                )}
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background p-2.5">
                  <Checkbox
                    checked={alsoDeleteJob}
                    onCheckedChange={(v) => onAlsoDeleteJobChange(v === true)}
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium">
                      Also delete the bootstrap job record
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      Wipes the row from the bootstrap history. Useful if you
                      want this run to disappear entirely — you&apos;ll still
                      see the audit log entry.
                    </span>
                  </span>
                </label>
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="space-y-2 text-sm">
            <ul className="space-y-1 rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-xs">
              {Object.entries(result.removed).map(([step, n]) => (
                <li key={step} className="flex justify-between">
                  <span>{STEP_LABELS[step] ?? step}</span>
                  <span className="text-muted-foreground">{n} removed</span>
                </li>
              ))}
              {result.deletedJob && (
                <li className="flex justify-between text-destructive">
                  <span>Bootstrap job row</span>
                  <span>deleted</span>
                </li>
              )}
            </ul>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={onConfirm}
                disabled={loading || !hasAnything}
              >
                {loading ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-3 w-3" />
                )}
                {alsoDeleteJob ? "Delete everything" : "Delete generations"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LiveAgentPanel({
  stream,
}: {
  stream: {
    step: string;
    phaseIndex: number;
    text: string;
    state: "streaming" | "done" | "error";
    error?: string;
    startedAt: number | null;
  };
}) {
  // Stick to the bottom only when the user is already there — if they've
  // scrolled up to read prior tokens, leave them alone instead of yanking
  // them back on every delta.
  const ref = useStickyBottom<HTMLPreElement>([stream.text]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {stream.state === "streaming" ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : stream.state === "error" ? (
            <AlertCircle className="h-4 w-4 text-destructive" />
          ) : (
            <Check className="h-4 w-4 text-emerald-600" />
          )}
          Agent · {stream.step}
          <Badge variant="outline" className="text-[10px]">
            call #{stream.phaseIndex + 1}
          </Badge>
          <ThroughputBadge
            text={stream.text}
            startedAt={stream.startedAt}
            running={stream.state === "streaming"}
          />
        </CardTitle>
        <CardDescription>
          {stream.state === "streaming"
            ? "Streaming tokens from the model. Persisted output appears in the live log once parsing succeeds."
            : stream.state === "error"
              ? `Stream failed: ${stream.error ?? "unknown error"}`
              : "Stream finished. Awaiting next phase…"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre
          ref={ref}
          className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-[11px] leading-snug"
        >
          {stream.text || (
            <span className="text-muted-foreground">…</span>
          )}
        </pre>
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  status,
  currentStep,
}: {
  status: string;
  currentStep: string | null;
}) {
  if (status === "completed") {
    return <Badge variant="default">completed</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">failed</Badge>;
  }
  if (status === "cancelled") {
    return <Badge variant="outline">cancelled</Badge>;
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Loader2 className="h-3 w-3 animate-spin" />
      {status}
      {currentStep ? ` · ${currentStep}` : ""}
    </Badge>
  );
}

function StateIcon({ state }: { state: string }) {
  if (state === "done") return <Check className="h-4 w-4 text-emerald-600" />;
  if (state === "error") return <X className="h-4 w-4 text-destructive" />;
  if (state === "running")
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (state === "interrupted")
    // Static icon (no spinner) so a cancelled job stops animating.
    return <X className="h-4 w-4 text-muted-foreground" />;
  return <ChevronRight className="h-4 w-4 text-muted-foreground" />;
}

function EventRow({ evt }: { evt: BootstrapEvent }) {
  const time = new Date(evt.ts).toLocaleTimeString();
  let color = "text-muted-foreground";
  if (evt.kind === "inserted") color = "text-emerald-600 dark:text-emerald-400";
  if (evt.kind === "skipped") color = "text-amber-600 dark:text-amber-400";
  if (evt.kind === "step-error" || evt.kind === "error")
    color = "text-destructive";
  if (evt.kind === "step-start" || evt.kind === "step-done")
    color = "text-foreground";
  if (evt.kind === "done")
    color = "text-emerald-700 dark:text-emerald-300";

  const summary = formatPayload(evt);

  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{time}</span>
      <span className="shrink-0 uppercase tracking-wide text-muted-foreground/80">
        {evt.step}
      </span>
      <span className={`shrink-0 ${color}`}>{evt.kind}</span>
      {summary && <span className="min-w-0 break-words">{summary}</span>}
    </div>
  );
}

function formatPayload(evt: BootstrapEvent): string | null {
  if (!evt.payload) return null;
  const p = evt.payload;
  if (evt.kind === "inserted") {
    return typeof p.name === "string" ? `"${p.name}"` : null;
  }
  if (evt.kind === "skipped") {
    return [
      typeof p.name === "string" ? `"${p.name}"` : null,
      typeof p.reason === "string" ? `(${p.reason})` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (evt.kind === "step-start") {
    return typeof p.target === "number" ? `target=${p.target}` : null;
  }
  if (evt.kind === "step-done") {
    return [
      typeof p.inserted === "number" ? `inserted=${p.inserted}` : null,
      typeof p.attempted === "number" ? `attempted=${p.attempted}` : null,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (evt.kind === "step-error" || evt.kind === "error") {
    return typeof p.error === "string" ? p.error : null;
  }
  return null;
}
