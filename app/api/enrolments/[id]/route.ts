// Approve or reject a self-enrolled rider. Approval flips the rider from
// pending_approval → active and (fees on) creates the registration invoice.
// Rejection flips to "rejected". The rules live in lib/enrolment-decision.ts,
// shared with the bulk queue. Permission: SUPER_ADMIN, ADMIN, CENTRE_MANAGER,
// SCHOOL_ADMINISTRATOR (verify: not SCHOOL_ADMINISTRATOR).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { z } from "zod";
import { APPROVER_ROLES, decideEnrolment } from "@/lib/enrolment-decision";

const schema = z.object({
  // "verify" records that a human opened this rider's documents and checked
  // them. "unverify" undoes that, for when a second look changes the answer.
  action: z.enum(["verify", "unverify", "approve", "reject"]),
  reason: z.string().max(300).optional(),
  note: z.string().max(300).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!APPROVER_ROLES.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const r = await decideEnrolment(session, params.id, parsed.data, {
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json(r.body, { status: r.status });
}
