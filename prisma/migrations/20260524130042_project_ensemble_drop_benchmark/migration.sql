-- Move ensembleJudges from Benchmark to Project (we'd just added it on
-- Benchmark; the user wants it per-project so it's reused across every
-- benchmark in a project instead of being re-configured per benchmark).
ALTER TABLE "Project"
  ADD COLUMN "ensembleJudges" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "Benchmark" DROP COLUMN "ensembleJudges";
