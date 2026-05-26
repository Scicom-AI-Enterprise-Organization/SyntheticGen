-- CreateTable
CREATE TABLE "EnsembleJudgeGroup" (
    "id"          TEXT NOT NULL,
    "projectId"   TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "judges"      JSONB NOT NULL DEFAULT '[]'::jsonb,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnsembleJudgeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnsembleJudgeGroup_projectId_name_key"
  ON "EnsembleJudgeGroup"("projectId", "name");

-- CreateIndex
CREATE INDEX "EnsembleJudgeGroup_projectId_idx"
  ON "EnsembleJudgeGroup"("projectId");

-- AddForeignKey
ALTER TABLE "EnsembleJudgeGroup"
  ADD CONSTRAINT "EnsembleJudgeGroup_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate any data sitting on Project.ensembleJudges (the
-- short-lived intermediate column we just shipped) into a "Default"
-- group per project, then drop the column.
INSERT INTO "EnsembleJudgeGroup" ("id", "projectId", "name", "judges", "createdAt", "updatedAt")
SELECT
  -- Same cuid-like shape as @default(cuid())
  'c' || substring(md5(p.id || 'default-group') from 1 for 24),
  p.id,
  'Default',
  p."ensembleJudges",
  NOW(),
  NOW()
FROM "Project" p
WHERE p."ensembleJudges" IS NOT NULL
  AND p."ensembleJudges"::text <> '[]'
  AND jsonb_typeof(p."ensembleJudges") = 'array'
  AND jsonb_array_length(p."ensembleJudges") > 0
ON CONFLICT DO NOTHING;

ALTER TABLE "Project" DROP COLUMN IF EXISTS "ensembleJudges";

-- AlterTable
ALTER TABLE "Benchmark"
  ADD COLUMN "defaultEnsembleGroupId" TEXT;

-- AddForeignKey
ALTER TABLE "Benchmark"
  ADD CONSTRAINT "Benchmark_defaultEnsembleGroupId_fkey"
  FOREIGN KEY ("defaultEnsembleGroupId") REFERENCES "EnsembleJudgeGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
