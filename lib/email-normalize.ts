import { z } from "zod";

// Canonical form for a LOGIN IDENTITY (User.email, PlatformUser.email).
//
// These columns answer "who is signing in", and Postgres `@unique` is
// case-sensitive. Storing an address as typed meant that a user saved as
// "Rahul@Club.in":
//   • got "Incorrect email or password" whenever they typed their own address
//     in lowercase — /api/auth/login matched exactly;
//   • could never use the email-code sign-in at all, because that path
//     lowercased before looking the user up and found nobody;
//   • did not block a SECOND account being created at "rahul@club.in", since
//     the unique index saw two different strings.
//
// So every write to, and lookup of, a login email goes through here. The
// migration that backfills existing rows also adds a CHECK (email = lower(email))
// on both tables, so a call site that forgets fails loudly at the database
// instead of quietly minting a shadow account.
//
// Deliberately case + surrounding whitespace ONLY. No dot-stripping, no
// plus-tag removal: those are provider-specific conventions, and folding
// "a+club@gmail.com" into "a@gmail.com" would merge two accounts their owner
// considers separate.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Zod field for a login identity — validates then canonicalises, so everything
// downstream of .parse() (the lookup, the rate-limit key, the insert) is
// already in canonical form and can't drift from one another.
// The 200-char cap matches what the admin-facing schemas already enforced and
// sits well above any real address (RFC 5321 tops out at 254).
//
// .trim() comes BEFORE .email(): zod runs checks in declaration order, and an
// address pasted out of a mail client routinely carries a trailing space. Trim
// last (or only inside the transform, which runs after validation) and that
// paste is rejected as "Invalid email" instead of being cleaned up.
export function emailIdentity() {
  return z.string().trim().email().max(200).transform(normalizeEmail);
}
