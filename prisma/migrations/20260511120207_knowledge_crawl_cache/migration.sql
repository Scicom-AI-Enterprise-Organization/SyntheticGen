-- CreateTable
CREATE TABLE "KnowledgeCrawl" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "startUrl" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "maxPages" INTEGER NOT NULL,
    "sameOriginOnly" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'running',
    "pages" JSONB,
    "pagesCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "KnowledgeCrawl_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeCrawl_projectId_startedAt_idx" ON "KnowledgeCrawl"("projectId", "startedAt");

-- AddForeignKey
ALTER TABLE "KnowledgeCrawl" ADD CONSTRAINT "KnowledgeCrawl_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
