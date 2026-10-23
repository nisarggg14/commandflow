ALTER TABLE "Company" ADD COLUMN "normalizedName" TEXT;

UPDATE "Company"
SET "normalizedName" = lower(btrim("name"));

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Company"
        GROUP BY "normalizedName"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot enforce normalized company-name uniqueness: duplicate company names exist. Resolve duplicates before retrying this migration.';
    END IF;
END $$;

ALTER TABLE "Company" ALTER COLUMN "normalizedName" SET NOT NULL;
CREATE UNIQUE INDEX "Company_normalizedName_key" ON "Company"("normalizedName");
