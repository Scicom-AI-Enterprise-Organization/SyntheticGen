-- AlterTable
ALTER TABLE "Benchmark" ADD COLUMN     "defaultRubricId" TEXT,
ADD COLUMN     "frozenConversationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'hf-function-call';

-- AlterTable
ALTER TABLE "BenchmarkResult" ADD COLUMN     "candidateMessages" JSONB,
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "costUsd" DECIMAL(12,6),
ADD COLUMN     "functionCallScore" JSONB,
ADD COLUMN     "judgeRationale" TEXT,
ADD COLUMN     "judgeScores" JSONB,
ADD COLUMN     "judgeVerdict" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'function-call',
ADD COLUMN     "referenceMessages" JSONB,
ADD COLUMN     "tokensIn" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tokensOut" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "validatorScores" JSONB,
ALTER COLUMN "expected" DROP NOT NULL,
ALTER COLUMN "predicted" DROP NOT NULL,
ALTER COLUMN "resultType" DROP NOT NULL,
ALTER COLUMN "funcMatch" DROP NOT NULL,
ALTER COLUMN "paramAccuracy" DROP NOT NULL,
ALTER COLUMN "similarity" DROP NOT NULL;

-- AlterTable
ALTER TABLE "BenchmarkRun" ADD COLUMN     "judgeModel" TEXT,
ADD COLUMN     "judgeProviderCredentialId" TEXT,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'function-call',
ADD COLUMN     "rubricId" TEXT,
ADD COLUMN     "samplingParams" JSONB;

-- CreateTable
CREATE TABLE "Rubric" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "axes" JSONB NOT NULL,
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Rubric_projectId_idx" ON "Rubric"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Rubric_projectId_name_key" ON "Rubric"("projectId", "name");

-- CreateIndex
CREATE INDEX "Benchmark_projectId_kind_idx" ON "Benchmark"("projectId", "kind");

-- CreateIndex
CREATE INDEX "BenchmarkResult_runId_kind_idx" ON "BenchmarkResult"("runId", "kind");

-- CreateIndex
CREATE INDEX "BenchmarkResult_runId_judgeVerdict_idx" ON "BenchmarkResult"("runId", "judgeVerdict");

-- AddForeignKey
ALTER TABLE "Benchmark" ADD CONSTRAINT "Benchmark_defaultRubricId_fkey" FOREIGN KEY ("defaultRubricId") REFERENCES "Rubric"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_judgeProviderCredentialId_fkey" FOREIGN KEY ("judgeProviderCredentialId") REFERENCES "ProviderCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
