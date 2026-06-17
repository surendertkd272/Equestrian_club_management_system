-- InjuryLog and Team carried a `centreId` scalar but no `centre` relation, so
-- tenantWhere()'s org-scope filter (`centre: { orgId }`) was an invalid Prisma
-- argument on them — /injuries and /teams crashed at runtime. Add the FK so both
-- are first-class centre-owned models like every other per-centre table.
-- (Both tables are empty in prod; the constraint applies with no backfill.)
-- AddForeignKey
ALTER TABLE "InjuryLog" ADD CONSTRAINT "InjuryLog_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_centreId_fkey" FOREIGN KEY ("centreId") REFERENCES "Centre"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
