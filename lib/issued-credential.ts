import { prisma } from "@/lib/prisma";
import { encryptPII, decryptPIISafe, isEncryptedPII } from "@/lib/pii";
import type { Prisma } from "@prisma/client";

// Credential handover for club onboarding.
//
// The problem this solves: HQ creates twenty accounts for a new academy, the
// server shows each temp password exactly once, and the sheet gets lost. The
// old answer was to reset all twenty — new passwords, everyone locked out of
// what they were given, one row at a time.
//
// So the generated temp password is kept, encrypted at rest with the same
// AES-256-GCM key as Aadhaar (lib/pii.ts), and can be re-read until the user
// replaces it.
//
// THE INVARIANT — this is the entire safety argument, and it is worth stating
// plainly because it is what makes this different from "storing passwords":
//
//   issuedPasswordEnc is non-null ONLY while the account's password is the
//   system-generated string the user has never replaced.
//
// It therefore never holds a password a person chose. That matters more than
// it sounds: people reuse their own passwords on their bank and their email,
// and a system-generated single-use string that is force-rotated on first
// sign-in is a categorically smaller thing to be holding. Bcrypt still guards
// the real credential — this column is a delivery receipt, not a password
// store.
//
// Every path that writes passwordHash MUST call clearIssuedCredential in the
// same transaction. If you add one and forget, the invariant breaks silently
// and this becomes a plaintext password store. tests/api/issued-credential
// asserts the invariant against every such route.

type Db = Prisma.TransactionClient | typeof prisma;

/** Record a freshly generated temp password so the sheet can be re-opened. */
export async function storeIssuedCredential(
  db: Db,
  userId: string,
  plain: string,
  issuedById: string | null,
): Promise<void> {
  const enc = encryptPII(plain);

  // FAIL CLOSED. encryptPII passes plaintext straight through when
  // PII_ENCRYPTION_KEY is unset — a deliberate choice for Aadhaar, where the
  // feature was meant to lie dormant until keys were provisioned everywhere.
  // It is the wrong behaviour here: it would write passwords to the database
  // in cleartext, which is the one thing this whole design exists to avoid.
  //
  // So verify we actually got ciphertext back. If not, store nothing. The
  // caller still receives the password and can hand it over — onboarding is
  // never blocked — the sheet simply cannot be re-opened until a key is set.
  // Degrading to "shown once" is an inconvenience; degrading to plaintext
  // passwords is an incident.
  if (!enc || !isEncryptedPII(enc)) {
    console.warn(
      "[issued-credential] PII_ENCRYPTION_KEY is not set — not storing the issued " +
        "password. The handover sheet will stay empty until a key is configured.",
    );
    return;
  }
  await db.user.update({
    where: { id: userId },
    data: { issuedPasswordEnc: enc, issuedPasswordAt: new Date(), issuedById },
  });
}

/**
 * Forget the issued credential. Call this from EVERY path that sets a
 * password — user-chosen rotation, forgot-password, admin-set manual
 * password. Skipping it is what would turn this into a real password store.
 */
export async function clearIssuedCredential(db: Db, userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { issuedPasswordEnc: null, issuedPasswordAt: null, issuedById: null },
  });
}

/** Same, as a fragment to merge into an existing update's `data`. */
export const CLEAR_ISSUED_CREDENTIAL = {
  issuedPasswordEnc: null,
  issuedPasswordAt: null,
  issuedById: null,
} satisfies Prisma.UserUpdateInput;

/** Decrypt for display. Returns null once the user has set their own password. */
export function revealIssuedCredential(enc: string | null | undefined): string | null {
  return decryptPIISafe(enc);
}
