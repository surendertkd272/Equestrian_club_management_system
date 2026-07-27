// Reject a submitted onboarding — marks it rejected with an optional reason.
// No User/Staff is created. Mirrors the approve route's auth + centre scoping.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

const schema = z.object({ reason: z.string().max(500).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const ob = await prisma.employeeOnboarding.findUnique({ where: { id: params.id } });
  if (!ob) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence33 = await centreFence(session, ob.centreId);
  if (fence33) {
    return NextResponse.json({ error: fence33 }, { status: 403 });
  }
  if (ob.status !== "submitted") return NextResponse.json({ error: "NOT_SUBMITTED" }, { status: 409 });

  await prisma.employeeOnboarding.update({
    where: { id: ob.id },
    data: {
      status: "rejected",
      reviewedByUserId: session.userId,
      reviewNotes: parsed.data.reason?.trim() || ob.reviewNotes,
      shareToken: null, // link consumed
    },
  });

  await audit({
    userId: session.userId,
    action: "staff_onboarding.rejected",
    tableName: "employeeOnboarding",
    rowId: ob.id,
    after: { reason: parsed.data.reason ?? null },
  });

  return NextResponse.json({ ok: true });
}
