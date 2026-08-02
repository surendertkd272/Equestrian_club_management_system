// DPDPA Section 12 grace window. A user who requests account deletion has this
// long to change their mind before lib/sweeps/dpdpa-deletions.ts hard-deletes
// them.
//
// Shared so the sweep, the request endpoint, the sign-in gate and the cancel
// endpoint can't disagree about when the account actually goes — the date we
// show the user has to be the date the sweep acts on.
export const DELETION_GRACE_MS = 30 * 86400000;

export function deletionScheduledFor(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_GRACE_MS);
}
