ALTER TABLE "Company" ADD COLUMN "invitationCodeHash" TEXT;
CREATE UNIQUE INDEX "Company_invitationCodeHash_key" ON "Company"("invitationCodeHash");
