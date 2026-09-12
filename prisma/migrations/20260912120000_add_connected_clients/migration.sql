-- ConnectedClient is present in schema.prisma but was not previously migrated.
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "Conversation" ADD COLUMN "connectedClientId" TEXT;

CREATE TABLE "ConnectedClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'BEARER',
    "authConfig" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConnectedClient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Conversation_connectedClientId_idx" ON "Conversation"("connectedClientId");
CREATE INDEX "ConnectedClient_companyId_idx" ON "ConnectedClient"("companyId");
CREATE INDEX "ConnectedClient_status_idx" ON "ConnectedClient"("status");
CREATE INDEX "ConnectedClient_slug_idx" ON "ConnectedClient"("slug");
CREATE UNIQUE INDEX "ConnectedClient_companyId_slug_key" ON "ConnectedClient"("companyId", "slug");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_connectedClientId_fkey" FOREIGN KEY ("connectedClientId") REFERENCES "ConnectedClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConnectedClient" ADD CONSTRAINT "ConnectedClient_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
