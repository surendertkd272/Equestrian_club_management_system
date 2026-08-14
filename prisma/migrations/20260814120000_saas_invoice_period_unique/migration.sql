-- One SaaS invoice per organisation per billing period.
--
-- Invoices were only ever created as a side-effect of a Stripe/Razorpay
-- webhook. Now that a monthly run issues them on a schedule — and an owner can
-- issue one by hand — "have we already billed this org for July?" has to be
-- answered by the database, not by the caller remembering. A retried cron, two
-- instances firing at once, or a manual issue overlapping the automatic one all
-- collide here rather than double-billing a customer.
--
-- Safe to apply as-is: SaasInvoice is empty in production, so there are no
-- existing duplicates to reconcile.
CREATE UNIQUE INDEX "SaasInvoice_orgId_periodStart_key"
  ON "SaasInvoice"("orgId", "periodStart");
