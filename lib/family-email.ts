import { isValidEmail } from "@/lib/email";
import { normalizeEmail } from "@/lib/email-normalize";
import { ageYears } from "@/lib/schemas/rider-onboarding";

// Whose login a family email address belongs to.
//
// User.email is unique, so an address can back ONE login. Student logins used
// to be keyed on the consent recipient — which falls back to the parent's
// email — so the bulk run handed the family address to the child, and the
// parent login that should have had it was then refused as "email taken".
// The rule now: a parent's address is the parent's. A student login uses the
// rider's own address, and only when it isn't a parent's.

type FamilyRider = {
  email?: string | null;
  dob?: Date | null;
  parentalConsentJson?: unknown;
  parentLinks?: { parent: { email: string | null } }[];
};

const norm = (e: unknown) => (typeof e === "string" && isValidEmail(e) ? normalizeEmail(e) : null);

/** Every address on file that belongs to the rider's parents. */
export function parentEmails(r: FamilyRider): Set<string> {
  const out = new Set<string>();
  for (const l of r.parentLinks ?? []) {
    const e = norm(l.parent.email);
    if (e) out.add(e);
  }
  const pc = r.parentalConsentJson as { parentEmail?: unknown } | null | undefined;
  const e = norm(pc?.parentEmail);
  if (e) out.add(e);
  return out;
}

/** The address for the rider's OWN (student) login, or null. */
export function studentLoginEmail(r: FamilyRider): { email: string | null; familyEmail: boolean } {
  const own = norm(r.email);
  if (!own) return { email: null, familyEmail: false };
  if (parentEmails(r).has(own)) return { email: null, familyEmail: true };
  return { email: own, familyEmail: false };
}

/**
 * The address for a parent login for this rider: the parent email from the
 * registration form, else — for a minor — the address on the rider's record,
 * which on a child's registration is the family's.
 */
export function parentLoginEmail(r: FamilyRider): string | null {
  const pc = r.parentalConsentJson as { parentEmail?: unknown } | null | undefined;
  const fromForm = norm(pc?.parentEmail);
  if (fromForm) return fromForm;
  const minor = r.dob ? ageYears(r.dob) < 18 : false;
  return minor ? norm(r.email) : null;
}
