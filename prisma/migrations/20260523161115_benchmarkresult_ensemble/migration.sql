-- AlterTable
ALTER TABLE "BenchmarkResult"
  ADD COLUMN "ensembleResult" JSONB,
  ADD COLUMN "ensembledAt"    TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "BenchmarkResult_runId_ensembledAt_idx"
  ON "BenchmarkResult"("runId", "ensembledAt");
