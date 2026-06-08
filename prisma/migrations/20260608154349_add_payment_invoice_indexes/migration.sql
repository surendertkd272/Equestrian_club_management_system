-- CreateIndex
CREATE INDEX "Invoice_centreId_status_idx" ON "Invoice"("centreId", "status");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_paidAt_idx" ON "Payment"("invoiceId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");
