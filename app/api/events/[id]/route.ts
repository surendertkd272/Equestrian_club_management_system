import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateEventSchema } from "@/lib/schemas/event";
import { audit } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "event.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const before = await prisma.event.findUnique({ where: { id: params.id } });
  if (!before) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && before.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
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

  const ev = await prisma.event.findUnique({ where: { id: params.id } });
  if (!ev) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && ev.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  // Hard delete blocked if the event has happened — keep finance trail.
  if (ev.status === "completed" || ev.status === "live") {
    return NextResponse.json({ error: "ACTIVE_OR_COMPLETED" }, { status: 409 });
  }

  await prisma.event.delete({ where: { id: ev.id } });
  await audit({ userId: session.userId, action: "event.delete", tableName: "event", rowId: ev.id, before: ev });
  return NextResponse.json({ ok: true });
}
