// Tells the Python internal API to start (or resume) a BenchmarkRun. The same
// `/internal/benchmark-runs/:id/start` endpoint the UI's startBenchmarkRun /
// restartBenchmarkRun server actions hit. Returns the fetch Response (or null
// on a network error) so callers can surface a soft "dispatch failed" warning
// without rolling back the row.
import { tryCall } from "@/lib/synthgen-api";

export async function dispatchBenchmarkRunStart(
  runId: string,
): Promise<Response | null> {
  return tryCall(
    () =>
      fetch(
        `${process.env.SYNTHGEN_API_URL ?? "http://localhost:8000"}/internal/benchmark-runs/${runId}/start`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-token": process.env.SYNTHGEN_INTERNAL_TOKEN ?? "",
          },
          cache: "no-store",
        },
      ),
    `start benchmark run ${runId}`,
  );
}
