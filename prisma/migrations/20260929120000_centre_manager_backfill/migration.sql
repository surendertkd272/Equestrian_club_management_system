-- Centre.managerId was never set for a centre created in the app (creating a
-- CENTRE_MANAGER didn't link them), so centre-manager notifications there went
-- nowhere. Fill ONLY empty links, with the centre's longest-serving active
-- centre manager. Existing links are left alone.
UPDATE "Centre" c
SET "managerId" = m.id
FROM (
  SELECT DISTINCT ON ("centreId") id, "centreId"
  FROM "User"
  WHERE role = 'CENTRE_MANAGER' AND status = 'active' AND "centreId" IS NOT NULL
  ORDER BY "centreId", "createdAt" ASC
) m
WHERE c."managerId" IS NULL AND m."centreId" = c.id;
