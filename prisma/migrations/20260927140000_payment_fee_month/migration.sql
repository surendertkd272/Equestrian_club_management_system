-- A fee payment says which month it is for, and who recorded it. See the
-- comments on Payment.feeMonth / recordedByUserId in schema.prisma.
ALTER TABLE "Payment" ADD COLUMN "feeMonth" TEXT;
ALTER TABLE "Payment" ADD COLUMN "recordedByUserId" TEXT;
