-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "originalFilename" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Contract" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
