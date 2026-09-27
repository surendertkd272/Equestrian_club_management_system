-- Time-limited accounts (visiting examiners): sign-in and sessions stop at
-- User.accessExpiresAt. User keeps its existing permissive RLS policy; a new
-- column needs no grant.
ALTER TABLE "User" ADD COLUMN "accessExpiresAt" TIMESTAMP(3);
