ALTER TABLE "ConnectedClient"
ADD COLUMN "lastConnectionTestStatus" TEXT,
ADD COLUMN "lastConnectionTestAt" TIMESTAMP(3);
