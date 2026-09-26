-- Approval requests that carry the change they are asking for.
--
-- A coach adjusting stock (or a head coach editing a horse) now raises a
-- request instead of writing directly; approving it applies the stored change.
-- Both columns are nullable: every existing request is a note with nothing to
-- apply, and stays that way.
ALTER TABLE "ApprovalRequest" ADD COLUMN "payloadJson" JSONB;
ALTER TABLE "ApprovalRequest" ADD COLUMN "appliedAt" TIMESTAMP(3);
