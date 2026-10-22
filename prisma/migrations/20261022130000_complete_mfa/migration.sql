ALTER TABLE "User"
  ADD COLUMN "pendingMfaSecret" TEXT,
  ADD COLUMN "pendingMfaExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lastMfaTotpStep" BIGINT;

UPDATE "User"
SET
  "pendingMfaSecret" = "mfaSecret",
  "pendingMfaExpiresAt" = CURRENT_TIMESTAMP,
  "mfaSecret" = NULL
WHERE "mfaEnabled" = false AND "mfaSecret" IS NOT NULL;

CREATE TABLE "MfaLoginChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "challengeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaLoginChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MfaLoginChallenge_challengeHash_key" ON "MfaLoginChallenge"("challengeHash");
CREATE INDEX "MfaLoginChallenge_userId_expiresAt_idx" ON "MfaLoginChallenge"("userId", "expiresAt");
CREATE UNIQUE INDEX "MfaRecoveryCode_codeHash_key" ON "MfaRecoveryCode"("codeHash");
CREATE INDEX "MfaRecoveryCode_userId_consumedAt_idx" ON "MfaRecoveryCode"("userId", "consumedAt");

ALTER TABLE "MfaLoginChallenge"
  ADD CONSTRAINT "MfaLoginChallenge_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MfaRecoveryCode"
  ADD CONSTRAINT "MfaRecoveryCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
