import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateEventSchema } from "@/lib/schemas/event";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// Allowed event status transitions. completed + cancelled are terminal — the
// edit form must not silently revert a finished/cancelled event (its finance +
// registration trail is why DELETE already protects those states).
const EVENT_NEXT: Record<string, string[]> = {
  draft: ["open", "cancelled"],
  open: ["live", "cancelled"],
  live: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "event.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const before = await prisma.event.findUnique({ where: { id: params.id } });
  if (!before) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence76 = await centreFence(session, before.centreId);
  if (fence76) {
    return NextResponse.json({ error: fence76 }, { status: 403 });
  }

  // Reject illegal status transitions (e.g. reopening a completed/cancelled
  // event). Same-status edits and non-status field edits pass through.
  if (parsed.data.status !== undefined && parsed.data.status !== before.status &&
      !(EVENT_NEXT[before.status] ?? []).includes(parsed.data.status)) {
    return NextResponse.json({ error: "ILLEGAL_TRANSITION", from: before.status, to: parsed.data.status }, { status: 409 });
  }

  // Cross-field date sanity. The update schema can't enforce end>=start (either
  // field may be absent on a PATCH), so a one-sided edit — moving endDate before
  // the stored startDate, or startDate past the stored endDate — would create an
  // inverted window that the create path already rejects. Merge incoming over
  // stored and re-check.
  const effStart = parsed.data.startDate !== undefined ? new Date(parsed.data.startDate) : before.startDate;
  const effEnd = parsed.data.endDate !== undefined ? new Date(parsed.data.endDate) : before.endDate;
  if (effEnd < effStart) {
    return NextResponse.json({ error: "INVALID_DATE_RANGE", message: "endDate must be on/after startDate" }, { status: 400 });
  }

  const updated = await prisma.event.update({
    where: { id: before.id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
      ...(parsed.data.externalVenue !== undefined ? { externalVenue: parsed.data.externalVenue ?? null } : {}),
      ...(parsed.data.externalHostOrg !== undefined ? { externalHostOrg: parsed.data.externalHostOrg ?? null } : {}),
      ...(parsed.data.startDate !== undefined ? { startDate: new Date(parsed.data.startDate) } : {}),
      ...(parsed.data.endDate !== undefined ? { endDate: new Date(parsed.data.endDate) } : {}),
      ...(parsed.data.fee !== undefined ? { fee: parsed.data.fee } : {}),
      ...(parsed.data.capacity !== undefined ? { capacity: parsed.data.capacity } : {}),
      ...(parsed.data.isPublic !== undefined ? { isPublic: parsed.data.isPublic } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.contactName !== undefined ? { contactName: parsed.data.contactName ?? null } : {}),
      ...(parsed.data.contactPhone !== undefined ? { contactPhone: parsed.data.contactPhone ?? null } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes ?? null } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "event.update",
    tableName: "event",
    rowId: updated.id,
    before: { status: before.status, title: before.title },
    after: { status: updated.status, title: updated.title },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "event.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const ev = await prisma.event.findUnique({ where: { id: params.id } });
  if (!ev) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // HQ roles carry centreId = null, so this comparison locked ADMIN out of
  // every centre while org-fencing nobody. centreFence does both.
  const fence1 = await centreFence(session, ev.centreId);
  if (fence1) {
    return NextResponse.json({ error: fence1 }, { status: 403 });
  }
  // Hard delete blocked if the event has happened — keep finance trail.
  if (ev.status === "completed" || ev.status === "live") {
    return NextResponse.json({ error: "ACTIVE_OR_COMPLETED" }, { status: 409 });
  }

  await prisma.event.delete({ where: { id: ev.id } });
  await audit({ userId: session.userId, action: "event.delete", tableName: "event", rowId: ev.id, before: ev });
  return NextResponse.json({ ok: true });
}
