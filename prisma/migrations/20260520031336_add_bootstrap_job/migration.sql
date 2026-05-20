-- CreateTable
CREATE TABLE "BootstrapJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "prompt" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "model" TEXT,
    "scope" JSONB NOT NULL,
    "currentStep" TEXT,
    "events" JSONB NOT NULL DEFAULT '[]',
    "inserted" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BootstrapJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BootstrapJob_projectId_createdAt_idx" ON "BootstrapJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "BootstrapJob_projectId_status_idx" ON "BootstrapJob"("projectId", "status");

-- AddForeignKey
ALTER TABLE "BootstrapJob" ADD CONSTRAINT "BootstrapJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BootstrapJob" ADD CONSTRAINT "BootstrapJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
