// Rider lifecycle statuses and the sets that different surfaces should show.
//
// A rider is created as "pending_payment" and only flips to "active" once the
// registration fee is paid online (app/api/payments/razorpay/*). Clubs that
// collect fees offline never trigger that flip, so their riders stay
// "pending_payment" indefinitely — yet they are real, attending students.
//
// COACH-FACING operational surfaces (attendance, lesson rider-picker) must
// therefore show every ENROLLED rider, paid or not — a child who shows up to
// ride has to be markable regardless of fee status. Self-enrolled riders still
// awaiting admin approval ("pending_approval") are NOT yet confirmed members and
// stay hidden until approved.
export const RIDER_STATUS = {
  ACTIVE: "active",
  PENDING_PAYMENT: "pending_payment",
  PENDING_APPROVAL: "pending_approval",
  // Imported from a spreadsheet, which cannot carry a signature. The rider is
  // a real member of the club but has no indemnity and no injury NOC on file,
  // so they must not appear on a register a coach could mark them present on.
  //
  // Flips to "active" automatically the moment consent is signed — by the
  // emailed link or by staff recording it. Deliberately automatic: a club
  // should never have a child standing at the gate because an administrator
  // has not clicked something.
  PENDING_CONSENT: "pending_consent",
} as const;

// Riders who are enrolled and attending — shown on the coach's daily tools.
//
// pending_consent is deliberately ABSENT. That omission is the entire gate:
// every coach-facing surface filters on this list, so an unsigned rider is
// simply not offered, rather than each page needing its own check that
// somebody could forget to add.
export const ENROLLED_RIDER_STATUSES = ["active", "pending_payment"] as const;

/** Why a rider is held back, for a human. */
export function riderBlockedReason(status: string): string | null {
  return status === "pending_consent"
    ? "No signed indemnity or injury NOC on file — this rider cannot be added to a register until consent is collected."
    : null;
}
