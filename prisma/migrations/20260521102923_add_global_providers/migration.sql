-- AlterTable
ALTER TABLE "ProviderCredential" ADD COLUMN     "sourceGlobalProviderId" TEXT;

-- CreateTable
CREATE TABLE "GlobalProviderCredential" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'openai',
    "baseUrl" TEXT NOT NULL,
    "encryptedApiKey" BYTEA NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "defaultModel" TEXT,
    "headers" JSONB,
    "reasoningEffort" TEXT,
    "chatTemplateKwargs" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlobalProviderCredential_name_key" ON "GlobalProviderCredential"("name");

-- CreateIndex
CREATE INDEX "GlobalProviderCredential_archivedAt_idx" ON "GlobalProviderCredential"("archivedAt");

-- CreateIndex
CREATE INDEX "ProviderCredential_sourceGlobalProviderId_idx" ON "ProviderCredential"("sourceGlobalProviderId");

-- AddForeignKey
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_sourceGlobalProviderId_fkey" FOREIGN KEY ("sourceGlobalProviderId") REFERENCES "GlobalProviderCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlobalProviderCredential" ADD CONSTRAINT "GlobalProviderCredential_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
