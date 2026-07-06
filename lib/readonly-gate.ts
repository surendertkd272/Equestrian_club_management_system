// Read-only mode gate. When an Organisation's status is "past_due" or
// "suspended", every write coming from a tenant user gets refused with 403
// READ_ONLY. Reads stay open, so the tenant can still log in, see their data,
// and fix billing — they just can't mutate.
//
// "trial" stays writable: it's a marketing tag, not a billing failure.
// "active" is the normal state.

import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { getOrgIdForSession } from "./features-gate";
import type { SessionPayload } from "./auth";

const READ_ONLY_STATUSES: ReadonlySet<string> = new Set(["past_due", "suspended"]);

export function isReadOnlyStatus(status: string | null | undefined): boolean {
  return !!status && READ_ONLY_STATUSES.has(status);
}

export async function isOrgReadOnly(orgId: string): Promise<boolean> {
  const o = await prisma.organisation.findUnique({
    where: { id: orgId },
    select: { status: true },
  });
  return isReadOnlyStatus(o?.status);
}

// Look up the active tenant's status for a session. Returns null when the
// session can't be resolved to an org (which would also block writes, but the
// caller may want to handle that as a separate error).
export async function getStatusForSession(session: SessionPayload | null): Promise<string | null> {
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return null;
  const o = await prisma.organisation.findUnique({ where: { id: orgId }, select: { status: true } });
  return o?.status ?? null;
}

export function readOnlyResponse(status: string) {
  return NextResponse.json(
    {
      error: "READ_ONLY",
      status,
      // Human message so the ~40 client callsites that read `data.message`
      // (bypassing humanizeError) show a sentence rather than "READ_ONLY".
      message: "This account is read-only (billing past due) — writes are paused. Contact your administrator.",
    },
    { status: 403 },
  );
}

// Single-shot guard for tenant write endpoints. Returns null if the org is
// writable; otherwise returns the response to send immediately.
//
//   const block = await blockIfReadOnly(session);
//   if (block) return block;
//
export async function blockIfReadOnly(session: SessionPayload | null): Promise<NextResponse | null> {
  const status = await getStatusForSession(session);
  if (status && isReadOnlyStatus(status)) return readOnlyResponse(status);
  return null;
}
