-- AlterTable
ALTER TABLE "Benchmark"
  ADD COLUMN "ensembleJudges" JSONB NOT NULL DEFAULT '[]'::jsonb;
