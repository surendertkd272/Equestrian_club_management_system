-- Canonicalise login identities to lowercase.
--
-- "User".email and "PlatformUser".email are the primary answer to "who is
-- signing in". The sign-in paths matched them exactly while Postgres @unique is
-- case-sensitive, so a row stored as 'Rahul@Club.in' could not sign in with the
-- address its owner actually types, could never use the email-code path (that
-- one lowercased before looking up, and found nobody), and did not stop a
-- SECOND account being created at 'rahul@club.in'.
--
-- Checked against production before writing this: 70 users, 1 mixed-case row,
-- and ZERO addresses that collide once lowercased — so the UPDATEs below cannot
-- trip the unique index there. If some other environment does hold a genuine
-- collision, this migration fails loudly and that data needs a human decision
-- (which of the two accounts is real) rather than a silent merge.

UPDATE "User"
   SET email = lower(btrim(email))
 WHERE email <> lower(btrim(email));

UPDATE "PlatformUser"
   SET email = lower(btrim(email))
 WHERE email <> lower(btrim(email));

-- Make it an invariant rather than a convention. Application code funnels every
-- write through normalizeEmail()/emailIdentity() (lib/email-normalize.ts), but
-- a new call site that forgets should fail at the database instead of quietly
-- minting a shadow account nobody can sign in to.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_lowercase" CHECK (email = lower(email));

ALTER TABLE "PlatformUser"
  ADD CONSTRAINT "PlatformUser_email_lowercase" CHECK (email = lower(email));
