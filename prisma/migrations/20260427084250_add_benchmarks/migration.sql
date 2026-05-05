-- CreateTable
CREATE TABLE "Benchmark" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL,
    "splits" TEXT[],
    "maxRowsPerSplit" INTEGER,
    "config" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Benchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkRun" (
    "id" TEXT NOT NULL,
    "benchmarkId" TEXT NOT NULL,
    "providerCredentialId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "metrics" JSONB,
    "totalTurns" INTEGER NOT NULL DEFAULT 0,
    "completedTurns" INTEGER NOT NULL DEFAULT 0,
    "failedTurns" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6),
    "tokensIn" BIGINT NOT NULL DEFAULT 0,
    "tokensOut" BIGINT NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenchmarkRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "split" TEXT NOT NULL,
    "rowIdx" INTEGER NOT NULL,
    "turnNum" INTEGER NOT NULL,
    "expected" JSONB NOT NULL,
    "predicted" JSONB NOT NULL,
    "resultType" TEXT NOT NULL,
    "funcMatch" BOOLEAN NOT NULL,
    "paramAccuracy" DOUBLE PRECISION NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "apiFailed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Benchmark_projectId_idx" ON "Benchmark"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Benchmark_projectId_name_key" ON "Benchmark"("projectId", "name");

-- CreateIndex
CREATE INDEX "BenchmarkRun_benchmarkId_createdAt_idx" ON "BenchmarkRun"("benchmarkId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "BenchmarkRun_benchmarkId_status_idx" ON "BenchmarkRun"("benchmarkId", "status");

-- CreateIndex
CREATE INDEX "BenchmarkResult_runId_split_idx" ON "BenchmarkResult"("runId", "split");

-- CreateIndex
CREATE INDEX "BenchmarkResult_runId_funcMatch_idx" ON "BenchmarkResult"("runId", "funcMatch");

-- AddForeignKey
ALTER TABLE "Benchmark" ADD CONSTRAINT "Benchmark_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Benchmark" ADD CONSTRAINT "Benchmark_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_benchmarkId_fkey" FOREIGN KEY ("benchmarkId") REFERENCES "Benchmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_providerCredentialId_fkey" FOREIGN KEY ("providerCredentialId") REFERENCES "ProviderCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkRun" ADD CONSTRAINT "BenchmarkRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenchmarkResult" ADD CONSTRAINT "BenchmarkResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BenchmarkRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
