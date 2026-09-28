import { isValidEmail } from "@/lib/email";

// Who a rider's exam result goes to.
//
// The result is for the family, so parents come first: every linked parent
// login, then the parent email captured on the registration form. The rider's
// own address is the fallback, for an adult rider or a family that gave only
// the one address. Before this only rider.email was used, so a child with no
// email of their own showed "No email on file" even with both parents linked.

export const RESULT_RECIPIENT_SELECT = {
  email: true,
  parentalConsentJson: true,
  parentLinks: { select: { parent: { select: { email: true, status: true } } } },
} as const;

export function resultRecipients(rider: {
  email?: string | null;
  parentalConsentJson?: unknown;
  parentLinks?: { parent: { email: string | null; status?: string | null } }[];
}): string[] {
  const out: string[] = [];
  const add = (e: unknown) => {
    if (typeof e !== "string" || !isValidEmail(e)) return;
    const v = e.trim();
    if (!out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  for (const link of rider.parentLinks ?? []) {
    if (link.parent.status && link.parent.status !== "active") continue;
    add(link.parent.email);
  }
  const pc = rider.parentalConsentJson as { parentEmail?: unknown } | null | undefined;
  add(pc?.parentEmail);
  if (out.length === 0) add(rider.email);
  return out;
}
