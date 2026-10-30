-- Persist the immutable continuation context for approved high-risk operations.
ALTER TABLE "Approval" ADD COLUMN "conversationId" TEXT;
ALTER TABLE "Approval" ADD COLUMN "argumentsJson" TEXT;
ALTER TABLE "Approval" ADD COLUMN "originalCommand" TEXT;
ALTER TABLE "Approval" ADD COLUMN "connectedClientId" TEXT;

CREATE INDEX "Approval_conversationId_idx" ON "Approval"("conversationId");
CREATE INDEX "Approval_connectedClientId_idx" ON "Approval"("connectedClientId");

ALTER TABLE "Approval"
  ADD CONSTRAINT "Approval_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
