import { hasFeature } from "@/lib/features-gate";

// May this club ever contact a family about money?
//
// A club can now track what riders owe purely for its own records, with the
// family never told, chased, or shown a bill. That promise is only worth
// anything if it cannot be broken by forgetting a check in one of the dozen
// places money reaches a parent — a reminder sweep, a portal tile, a payment
// link, a report card line, a WhatsApp template added next year.
//
// So the rule lives in ONE function and every such surface asks it. The
// question is deliberately phrased as "may we contact them", not "is billing
// on": a new surface author has to answer a question about the FAMILY, which
// is much harder to get wrong than remembering which of two feature flags
// applies to the code they happen to be writing.
//
// dues-tracking has no say here. Knowing what someone owes and telling them
// are different acts, and the entire point of the internal mode is that the
// first happens without the second.

/** True only when the club has parent-facing payments switched on. */
export async function canContactAboutMoney(orgId: string | null | undefined): Promise<boolean> {
  if (!orgId) return false; // Fail closed: unknown club, no contact.
  return hasFeature(orgId, "fee-collection");
}

/** Whether the club records what riders owe, for its own books. */
export async function tracksDues(orgId: string | null | undefined): Promise<boolean> {
  if (!orgId) return false;
  // Parent-facing billing implies dues exist — a club that bills families is
  // obviously tracking what they owe. So either flag turns this on, and a club
  // that had fee-collection on before dues-tracking existed keeps working
  // without anyone re-configuring it.
  const [dues, billing] = await Promise.all([
    hasFeature(orgId, "dues-tracking"),
    hasFeature(orgId, "fee-collection"),
  ]);
  return dues || billing;
}

/** Centre-scoped convenience for the two questions above. */
export async function centreTracksDues(centreId: string): Promise<boolean> {
  const { getOrgIdForCentre } = await import("@/lib/features-gate");
  return tracksDues(await getOrgIdForCentre(centreId));
}

export async function centreCanContactAboutMoney(centreId: string): Promise<boolean> {
  const { getOrgIdForCentre } = await import("@/lib/features-gate");
  return canContactAboutMoney(await getOrgIdForCentre(centreId));
}
