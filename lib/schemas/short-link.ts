import { z } from "zod";

// Catalog of supported deep-link kinds. Each maps to a form path; the API
// validates kind ∈ this list and uses the path as the redirect target so
// admins can't forge links into restricted areas via custom targetPath.
export const SHORT_LINK_KINDS = {
  // /injuries hosts both the list and the "Log a new injury" card inline —
  // there's no separate /new route. Old links that targeted /injuries/new
  // 404'd; we redirect to /injuries and the page handles the rest.
  injury: { label: "Injury report", targetPath: "/injuries" },
  rider_onboard: { label: "Rider onboarding", targetPath: "/onboarding" },
  // Staff hiring invite — recipient registers via /staff-register?code=...,
  // SUPER_ADMIN / ADMIN approves before the account is enabled.
  staff_hire: { label: "Staff hiring invite", targetPath: "/staff-register" },
  // Venue booking confirmation — admin records the booking + payment in
  // /facility-bookings, then shares this link with the renter. Recipient
  // sees the booking details + tap-to-add-to-calendar.
  venue_booking: { label: "Venue booking confirmation", targetPath: "/booking-confirmation" },
  expense_submit: { label: "Invoice submission", targetPath: "/expenses/submit" },
  requisition: { label: "New requisition", targetPath: "/requisitions/new" },
  vet_visit_horse: { label: "Vet visit (per horse)", targetPath: "" }, // path resolved per-horse at create-time
  generic: { label: "Other", targetPath: "" },
} as const;

export type ShortLinkKind = keyof typeof SHORT_LINK_KINDS;

export const createShortLinkSchema = z.object({
  kind: z.enum(["injury", "rider_onboard", "staff_hire", "venue_booking", "expense_submit", "requisition", "vet_visit_horse", "generic"]),
  // For "generic" + "vet_visit_horse" the admin supplies the target path.
  // For known kinds we ignore this and use the catalog mapping.
  targetPath: z.string().regex(/^\/[a-zA-Z0-9_\-\/\[\]]+$/, "Target path must start with /").max(200).optional(),
  params: z.record(z.string()).optional(),
  label: z.string().max(120).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(90).default(14),
  singleUse: z.boolean().default(false),
});

export type CreateShortLinkInput = z.infer<typeof createShortLinkSchema>;

// Crockford base32 alphabet — easy to read aloud + type on a phone,
// excludes ambiguous chars (I, L, O, U).
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateShortCode(len = 8): string {
  let out = "";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}
