-- Post-hoc consent collection for riders who never saw the registration form.
--
-- Bulk import and staff-created riders have no indemnity signature, so a club
-- could import 90 riders and have every one of them mounting with nothing on
-- file. This table backs an emailed, tokenised link to the same versioned
-- agreement the public form uses.
CREATE TABLE "RiderConsentRequest" (
  "id"          TEXT NOT NULL,
  "riderId"     TEXT NOT NULL,
  "centreId"    TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "tokenHash"   TEXT NOT NULL,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "sentAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "remindedAt"  TIMESTAMP(3),
  "signedAt"    TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiderConsentRequest_pkey" PRIMARY KEY ("id")
);

-- The token is stored hashed, and the lookup is BY that hash.
CREATE UNIQUE INDEX "RiderConsentRequest_tokenHash_key" ON "RiderConsentRequest"("tokenHash");
CREATE INDEX "RiderConsentRequest_centreId_signedAt_idx" ON "RiderConsentRequest"("centreId", "signedAt");
CREATE INDEX "RiderConsentRequest_riderId_signedAt_idx" ON "RiderConsentRequest"("riderId", "signedAt");

ALTER TABLE "RiderConsentRequest" ADD CONSTRAINT "RiderConsentRequest_riderId_fkey"
  FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiderConsentRequest" ADD CONSTRAINT "RiderConsentRequest_centreId_fkey"
  FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS. Supabase auto-enables row level security on new tables, so a table with
-- no policy is deny-all and every query against it fails at runtime rather
-- than at deploy. Same org-isolation shape as every other centre-scoped table.
ALTER TABLE "RiderConsentRequest" ENABLE ROW LEVEL SECURITY;
-- FORCE as well as ENABLE: without it the policy is skipped for the table's
-- owner, and the app connects as a role that would sail straight past it.
ALTER TABLE "RiderConsentRequest" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "RiderConsentRequest_org_isolation" ON "RiderConsentRequest";
CREATE POLICY "RiderConsentRequest_org_isolation" ON "RiderConsentRequest"
  FOR ALL
  USING (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  )
  WITH CHECK (
    current_setting('app.rls_enforce', true) IS DISTINCT FROM 'on'
    OR current_setting('app.rls_bypass', true) = 'on'
    OR "centreId" IN (SELECT "id" FROM "Centre" WHERE "orgId" = current_setting('app.org_id', true))
  );
