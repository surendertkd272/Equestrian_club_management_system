import { z } from "zod";

// Shared phone validators. Every path that captures a contact number must use
// these, because a bad number does not fail loudly — it is accepted, stored,
// and then every SMS / WhatsApp / email to that family is dropped at the
// dispatch layer while the club believes the parent was told about a fee, an
// exam result, or an injury.
//
// The rules were previously per-schema and length-only (`min(10)`), so
// "nine eight one" and 12-digit fat-fingers passed on the public signup form
// AND on bulk CSV import — the one path where nobody eyeballs each value.

const stripSeparators = (s: string) => s.replace(/[\s()\-.]/g, "");

/**
 * A real Indian mobile, accepting the formats people actually type —
 * "9811045566", "+91 98110 45566", "098110-45566" — and normalising all of
 * them to the bare 10 digits so stored values compare like with like.
 */
export const indianMobile = (msg = "Enter a 10-digit Indian mobile number") =>
  z
    .string()
    .transform(stripSeparators)
    .refine((s) => /^(?:\+?91|0)?[6-9]\d{9}$/.test(s), msg)
    // Strip a country code / trunk 0 only when one is actually there (more
    // than 10 digits). A bare 10-digit mobile that happens to START with 91 —
    // 91xxxxxxxx is a real series — was cut to 8 digits ("9100014662" →
    // "00014662"), and every SMS and WhatsApp to that family then failed
    // silently at dispatch.
    .transform(stripCountryCode);

/** "+91 98110 45566" / "09811045566" / "9811045566" → "9811045566". */
export function stripCountryCode(s: string): string {
  const bare = stripSeparators(s);
  return bare.length > 10 ? bare.replace(/^(?:\+?91|0)/, "") : bare;
}

/**
 * A mobile OR an STD-code landline. For emergency contacts, which are often a
 * clinic or a hospital switchboard rather than a personal handset.
 */
export const indianPhone = (msg = "Enter a valid Indian phone number") =>
  z
    .string()
    .transform(stripSeparators)
    .refine(
      (s) => /^(?:\+?91|0)?[6-9]\d{9}$/.test(s) || /^0\d{2,4}\d{6,8}$/.test(s),
      msg,
    );
