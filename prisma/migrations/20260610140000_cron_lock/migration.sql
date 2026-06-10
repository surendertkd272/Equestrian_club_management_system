-- Single-flight lock for the nightly sweep batch (H5). The cron route claims
-- this row before runAllSweeps and releases it after, so overlapping runs skip
-- instead of re-firing every job. Stale locks auto-expire (handled in the route).
CREATE TABLE "CronLock" (
  "id"        TEXT NOT NULL,
  "lockedAt"  TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CronLock_pkey" PRIMARY KEY ("id")
);
