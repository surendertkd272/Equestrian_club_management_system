-- Payment's org-isolation policy scoped rows THROUGH the invoice:
--   EXISTS (SELECT 1 FROM "Invoice" p WHERE p."id" = "Payment"."invoiceId")
-- written when invoiceId was NOT NULL. 20260903170000_payment_receipts made it
-- nullable (a receipt / advance settles no invoice) and gave Payment its own
-- centreId, but left the policy alone. Under RLS_ENFORCE=1 every invoice-less
-- payment therefore failed WITH CHECK: recording ₹5,000 against a ₹3,000
-- invoice (₹2,000 kept as an advance) rolled back with "unable to save", and
-- any receipt was unwritable and unreadable.
--
-- Scope by the row's own centre instead, like every other centre-owned table.
-- Equivalent for invoice payments: their centreId was backfilled from the
-- invoice and is always written from it.
DROP POLICY IF EXISTS "Payment_org_isolation" ON "Payment";
CREATE POLICY "Payment_org_isolation" ON "Payment" FOR ALL
  USING (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()))
  WITH CHECK (current_setting('app.rls_enforce',true) IS DISTINCT FROM 'on' OR current_setting('app.rls_bypass',true)='on' OR "centreId" = ANY(app_centre_ids()));
