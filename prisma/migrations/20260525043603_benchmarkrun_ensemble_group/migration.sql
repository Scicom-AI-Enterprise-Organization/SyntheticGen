-- AlterTable
ALTER TABLE "BenchmarkRun"
  ADD COLUMN "ensembleGroupId"  TEXT,
  ADD COLUMN "consensusMethod"  TEXT NOT NULL DEFAULT 'median';

-- AddForeignKey
ALTER TABLE "BenchmarkRun"
  ADD CONSTRAINT "BenchmarkRun_ensembleGroupId_fkey"
  FOREIGN KEY ("ensembleGroupId") REFERENCES "EnsembleJudgeGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
