import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

const createSchema = z.object({
  staffUserId: z.string().min(1),
  direction: z.enum(["in", "out"]),
  occurredAt: z.string().datetime().optional(),
  notes: z.string().max(200).optional(),
  // SUPER_ADMIN must supply this since their session has no centreId pin.
  // Centre-scoped users ignore this field (their session centre wins).
  centreId: z.string().min(1).optional(),
});

// GET — list recent gate events. Default scope: this centre, last 24h.
//   ?staffUserId=… narrows to one person
//   ?fromMs=… overrides the time window (epoch ms)
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.attendance")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const centreId = scopeCentre(session);
  const url = new URL(req.url);
  const staffUserId = url.searchParams.get("staffUserId");
  const fromMs = Number(url.searchParams.get("fromMs") ?? Date.now() - 86400000);

  const events = await prisma.staffGateEvent.findMany({
    where: {
      ...centreWhere(centreId),
      ...(staffUserId ? { staffUserId } : {}),
      occurredAt: { gte: new Date(fromMs) },
    },
    include: { staff: { select: { id: true, name: true, role: true } } },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.attendance")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  // Centre resolution: session centre for centre-scoped users; body for SUPER_ADMIN.
  const centreId =
    session.role === "SUPER_ADMIN"
      ? parsed.data.centreId ?? null
      : scopeCentre(session);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  // Confirm the staff user belongs to this centre — prevents a hostile
  // payload from logging gate events against someone else's roster.
  const staff = await prisma.user.findUnique({
    where: { id: parsed.data.staffUserId },
    select: { id: true, name: true, centreId: true, role: true },
  });
  if (!staff || staff.centreId !== centreId) {
    return NextResponse.json({ error: "INVALID_STAFF" }, { status: 400 });
  }

  const row = await prisma.staffGateEvent.create({
    data: {
      centreId,
      staffUserId: staff.id,
      direction: parsed.data.direction,
      occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date(),
      notes: parsed.data.notes ?? null,
      recordedByUserId: session.userId,
    },
  });

  await audit({
    userId: session.userId,
    action: `gate.${parsed.data.direction}`,
    tableName: "staffGateEvent",
    rowId: row.id,
    after: { staffName: staff.name, staffRole: staff.role, direction: parsed.data.direction },
  });

  return NextResponse.json({ ok: true, id: row.id });
}
