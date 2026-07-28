import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createRegistrationSchema } from "@/lib/schemas/event";
import { audit } from "@/lib/audit";
import { isFeatureEnabledForCentre } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// POST — register a rider for an event. Auto-creates an invoice when
// Event.fee > 0 so the finance module picks up event income alongside
// monthly fees and other registration income.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "event.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const block = await blockIfReadOnly(session);
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = createRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const ev = await prisma.event.findUnique({ where: { id: params.id } });
  if (!ev) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence1 = await centreFence(session, ev.centreId);
  if (fence1) {
    return NextResponse.json({ error: fence1 }, { status: 403 });
  }
  if (ev.status === "completed" || ev.status === "cancelled") {
    return NextResponse.json({ error: "EVENT_CLOSED" }, { status: 409 });
  }

  // Soft capacity check.
  if (ev.capacity) {
    const filled = await prisma.eventRegistration.count({
      where: { eventId: ev.id, status: { not: "cancelled" } },
    });
    if (filled >= ev.capacity) {
      return NextResponse.json({ error: "FULL", message: "Event is at capacity." }, { status: 409 });
    }
  }

  const rider = await prisma.rider.findUnique({ where: { id: parsed.data.riderId } });
  if (!rider) return NextResponse.json({ error: "RIDER_NOT_FOUND" }, { status: 404 });
  if (rider.centreId !== ev.centreId) {
    return NextResponse.json({ error: "RIDER_CROSS_CENTRE" }, { status: 400 });
  }

  // Fee-collection master switch. When OFF, registration is recorded as
  // paid + no invoice is created. Event.fee stays untouched so toggling
  // fees back ON later resumes billing.
  const feesOn = await isFeatureEnabledForCentre(ev.centreId, "fee-collection");
  const billable = feesOn && ev.fee > 0;

  try {
    // H6 — register + auto-invoice atomically. Previously these were two
    // separate writes: a crash between them left a registered, UNPAID rider
    // with no invoice (invisible to the fee-due sweep + the HQ "unpaid" tile →
    // silent revenue loss). One transaction → both commit or neither does.
    const { reg, invoiceId } = await prisma.$transaction(async (tx) => {
      const reg = await tx.eventRegistration.create({
        data: {
          eventId: ev.id,
          riderId: rider.id,
          notes: parsed.data.notes,
          paid: !billable,
        },
      });
      let invoiceId: string | null = null;
      if (billable) {
        const inv = await tx.invoice.create({
          data: {
            centreId: ev.centreId,
            riderId: rider.id,
            amount: ev.fee,
            dueDate: ev.startDate,
            kind: "event",
            status: "due",
          },
        });
        invoiceId = inv.id;
      }
      return { reg, invoiceId };
    });

    await audit({
      userId: session.userId,
      action: "event.register",
      tableName: "eventRegistration",
      rowId: reg.id,
      after: { eventId: ev.id, riderId: rider.id, invoiceId },
    });
    return NextResponse.json({ id: reg.id, invoiceId });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "ALREADY_REGISTERED" }, { status: 409 });
    }
    throw e;
  }
}
