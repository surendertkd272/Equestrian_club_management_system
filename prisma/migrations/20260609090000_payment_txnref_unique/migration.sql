-- Enforce idempotency on payment gateway references: a re-delivered webhook or
-- the verify-redirect racing the webhook can no longer double-insert the same
-- Razorpay payment id. Postgres permits multiple NULLs, so ref-less cash
-- payments are unaffected.
CREATE UNIQUE INDEX "Payment_txnRef_key" ON "Payment"("txnRef");
