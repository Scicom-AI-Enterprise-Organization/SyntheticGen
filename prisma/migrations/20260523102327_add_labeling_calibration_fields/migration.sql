-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "labelingApiKeyEnc" TEXT,
ADD COLUMN     "labelingBaseUrl" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "calibrationExpected" JSONB,
ADD COLUMN     "isCalibration" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BenchmarkRun" ADD COLUMN     "calibrationReport" JSONB;

-- CreateIndex
CREATE INDEX "Conversation_projectId_isCalibration_idx" ON "Conversation"("projectId", "isCalibration");
