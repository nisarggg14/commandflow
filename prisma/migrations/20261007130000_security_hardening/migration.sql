ALTER TYPE "ApprovalStatus" ADD VALUE IF NOT EXISTS 'EXECUTING';
ALTER TYPE "ApprovalStatus" ADD VALUE IF NOT EXISTS 'FAILED';
CREATE TABLE "RateLimitBucket" ("id" TEXT NOT NULL, "key" TEXT NOT NULL, "count" INTEGER NOT NULL, "windowStart" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "RateLimitBucket_key_key" ON "RateLimitBucket"("key");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
ALTER TABLE "Automation" ADD COLUMN "lastExecutionStatus" TEXT;
