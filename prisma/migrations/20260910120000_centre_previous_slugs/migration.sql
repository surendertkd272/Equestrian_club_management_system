-- Slugs a centre used to answer to, so renaming one does not kill every
-- registration link already in circulation.
--
-- The public URL is ?centre=<slug>, and those get printed on noticeboards and
-- forwarded through school WhatsApp groups. A renamed slug produces no error
-- a parent can act on — the page simply stops naming a centre.
ALTER TABLE "Centre" ADD COLUMN "previousSlugs" TEXT[] NOT NULL DEFAULT '{}';

-- Equiwings Noida was created with the slug "gurgaon" (wrong city) and
-- renamed to "noida" on 2026-09-10. Any link shared before then keeps working.
UPDATE "Centre" SET "previousSlugs" = ARRAY['gurgaon']
WHERE slug = 'noida' AND name = 'Equiwings Noida';

-- The fallback lookup is "find the centre that used to be called X".
CREATE INDEX "Centre_previousSlugs_idx" ON "Centre" USING GIN ("previousSlugs");
