import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createAllocationSchema, DEFAULT_WORKLOAD_CAP_MIN } from "@/lib/schemas/horse";
import { audit } from "@/lib/audit";
import { AllocConflict } from "@/lib/allocation-guard";

function parseLocalDate(s: string): Date {
  // Accept "YYYY-MM-DDTHH:MM" (local) or full ISO; treat plain form as local time.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return new Date(s);
  return new Date(s);
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "horse.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createAllocationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const horse = await prisma.horse.findUnique({ where: { id: params.id } });
  if (!horse) return NextResponse.json({ error: "HORSE_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && horse.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (horse.status !== "active") {
    return NextResponse.json(
      { error: "HORSE_NOT_AVAILABLE", message: `Horse is ${horse.status}; allocations not allowed.` },
      { status: 409 },
    );
  }
  // Drug-withdrawal hold (C4): refuse allocation while any administered
  // medicine's withdrawal period is still active. This is the real compliance
  // gate — horse.status is manually editable and can be flipped back to
  // "active" before the withdrawal elapses, so we check withdrawalUntil directly.
  const activeWithdrawal = await prisma.medicineUsage.findFirst({
    where: { horseId: horse.id, withdrawalUntil: { gt: new Date() } },
    select: { withdrawalUntil: true },
    orderBy: { withdrawalUntil: "desc" },
  });
  if (activeWithdrawal) {
    return NextResponse.json(
      {
        error: "WITHDRAWAL_ACTIVE",
        message: `${horse.name} is under drug withdrawal until ${activeWithdrawal.withdrawalUntil!.toISOString().slice(0, 10)}; allocations not allowed.`,
      },
      { status: 409 },
    );
  }

  const startAt = parseLocalDate(d.startAt);
  const endAt = parseLocalDate(d.endAt);
  if (!(endAt > startAt)) {
    return NextResponse.json({ error: "INVALID_TIME", message: "endAt must be after startAt" }, { status: 400 });
  }
  // H3 — the daily workload cap buckets by the start-day only, so a multi-day
  // (or midnight-spanning) allocation would be mis-counted: its full duration
  // lands on day 1 and days it actually occupies read as free. Reject it and
  // make the caller split it into per-day allocations, which the daily cap can
  // count correctly. (endAt is treated as exclusive so a session ending exactly
  // at midnight still counts as same-day.)
  const endDayRef = new Date(endAt.getTime() - 1);
  if (startOfDay(startAt).getTime() !== startOfDay(endDayRef).getTime()) {
    return NextResponse.json(
      { error: "MULTI_DAY_ALLOCATION", message: "An allocation must fall within a single day; split multi-day bookings into one per day." },
      { status: 400 },
    );
  }

  if (d.riderId) {
    const rider = await prisma.rider.findUnique({ where: { id: d.riderId } });
    if (!rider) return NextResponse.json({ error: "RIDER_NOT_FOUND" }, { status: 404 });
    if (rider.centreId !== horse.centreId) {
      return NextResponse.json({ error: "RIDER_CROSS_CENTRE" }, { status: 400 });
    }
  }

  // Atomic check-and-insert (C2): lock the horse row FOR UPDATE so two
  // concurrent allocations can't both read "no overlap / under cap" and then
  // both insert (double-booking the horse or busting the daily cap). The
  // overlap + cap reads and the create all run inside the locked transaction.
  let allocation;
  try {
    allocation = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Horse" WHERE id = ${horse.id} FOR UPDATE`;

      const overlap = await tx.horseAllocation.findFirst({
        where: { horseId: horse.id, startAt: { lt: endAt }, endAt: { gt: startAt } },
        select: { id: true, startAt: true, endAt: true, purpose: true },
      });
      if (overlap) {
        throw new AllocConflict(
          "OVERLAP",
          `Conflicts with existing ${overlap.purpose} from ${overlap.startAt.toISOString()} to ${overlap.endAt.toISOString()}`,
        );
      }

      // Daily workload cap (active hours on the start-day).
      const dayStart = startOfDay(startAt);
      const dayEnd = endOfDay(startAt);
      const sameDay = await tx.horseAllocation.findMany({
        where: { horseId: horse.id, startAt: { gte: dayStart, lte: dayEnd } },
        select: { startAt: true, endAt: true },
      });
      const usedMin =
        sameDay.reduce((s, a) => s + (a.endAt.getTime() - a.startAt.getTime()) / 60000, 0) +
        (endAt.getTime() - startAt.getTime()) / 60000;
      if (usedMin > DEFAULT_WORKLOAD_CAP_MIN) {
        throw new AllocConflict(
          "WORKLOAD_EXCEEDED",
          `This would push ${horse.name} past the daily ${DEFAULT_WORKLOAD_CAP_MIN}-minute work cap (${Math.round(usedMin)} min total).`,
        );
      }

      return tx.horseAllocation.create({
        data: { horseId: horse.id, riderId: d.riderId ?? null, purpose: d.purpose, startAt, endAt },
      });
    });
  } catch (e) {
    if (e instanceof AllocConflict) {
      return NextResponse.json({ error: e.code, message: e.message }, { status: 409 });
    }
    throw e;
  }

  await audit({
    userId: session.userId,
    action: "create",
    tableName: "horseAllocation",
    rowId: allocation.id,
    after: { horseId: horse.id, riderId: d.riderId, purpose: d.purpose, startAt, endAt },
  });

  return NextResponse.json({ id: allocation.id });
}
