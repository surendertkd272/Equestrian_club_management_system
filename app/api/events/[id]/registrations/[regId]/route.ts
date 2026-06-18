import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateRegistrationSchema } from "@/lib/schemas/event";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; regId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "event.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const block = await blockIfReadOnly(session);
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = updateRegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const reg = await prisma.eventRegistration.findUnique({
    where: { id: params.regId },
    include: { event: { select: { centreId: true } } },
  });
  if (!reg || reg.eventId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (session.role !== "SUPER_ADMIN" && reg.event.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const updated = await prisma.eventRegistration.update({
    where: { id: reg.id },
    data: {
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.paid !== undefined ? { paid: parsed.data.paid } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes ?? null } : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "event.registration_update",
    tableName: "eventRegistration",
    rowId: reg.id,
    before: { status: reg.status, paid: reg.paid },
    after: { status: updated.status, paid: updated.paid },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; regId: string } },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "event.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const block = await blockIfReadOnly(session);
  if (block) return block;

  const reg = await prisma.eventRegistration.findUnique({
    where: { id: params.regId },
    include: { event: { select: { centreId: true } } },
  });
  if (!reg || reg.eventId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (session.role !== "SUPER_ADMIN" && reg.event.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  await prisma.eventRegistration.delete({ where: { id: reg.id } });
  await audit({
    userId: session.userId,
    action: "event.registration_delete",
    tableName: "eventRegistration",
    rowId: reg.id,
  });
  return NextResponse.json({ ok: true });
}
