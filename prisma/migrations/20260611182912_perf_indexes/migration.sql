-- CreateIndex
CREATE INDEX "Attendance_batchId_date_idx" ON "Attendance"("batchId", "date");

-- CreateIndex
CREATE INDEX "HorseAllocation_riderId_startAt_idx" ON "HorseAllocation"("riderId", "startAt");

-- CreateIndex
CREATE INDEX "MedicineUsage_medicineId_usedAt_idx" ON "MedicineUsage"("medicineId", "usedAt");

-- CreateIndex
CREATE INDEX "MedicineUsage_horseId_usedAt_idx" ON "MedicineUsage"("horseId", "usedAt");

-- CreateIndex
CREATE INDEX "Invoice_riderId_status_idx" ON "Invoice"("riderId", "status");

-- CreateIndex
CREATE INDEX "Certificate_riderId_issuedAt_idx" ON "Certificate"("riderId", "issuedAt");

