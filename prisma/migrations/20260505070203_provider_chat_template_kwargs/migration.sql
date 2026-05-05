/*
  Warnings:

  - You are about to drop the column `enableThinking` on the `ProviderCredential` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ProviderCredential" DROP COLUMN "enableThinking",
ADD COLUMN     "chatTemplateKwargs" JSONB;
