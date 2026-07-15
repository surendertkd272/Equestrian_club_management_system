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
} as const;

// Riders who are enrolled and attending — shown on the coach's daily tools.
export const ENROLLED_RIDER_STATUSES = ["active", "pending_payment"] as const;
