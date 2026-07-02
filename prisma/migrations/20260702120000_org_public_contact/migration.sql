-- Public-facing contact details on the org, editable by SUPER_ADMIN/ADMIN in
-- /settings and shown on the Help Center + portals.
ALTER TABLE "Organisation" ADD COLUMN "supportEmail" TEXT;
ALTER TABLE "Organisation" ADD COLUMN "supportPhone" TEXT;

-- Seed the public contact email for existing orgs.
UPDATE "Organisation" SET "supportEmail" = 'info@equiwings.com' WHERE "supportEmail" IS NULL;
