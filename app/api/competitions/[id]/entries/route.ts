import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createEntrySchema, parseClasses } from "@/lib/schemas/competition";
import { audit } from "@/lib/audit";
import { isFeatureEnabledForCentre } from "@/lib/features-gate";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const comp = await prisma.competition.findUnique({ where: { id: params.id } });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (comp.status === "completed" || comp.status === "cancelled") {
    return NextResponse.json({ error: "CLOSED", message: "Competition is no longer accepting entries." }, { status: 409 });
  }

  const classes = parseClasses(comp.classesJson);
  const cls = classes.find((c) => c.name === d.className);
  if (!cls) return NextResponse.json({ error: "UNKNOWN_CLASS" }, { status: 400 });

  if (comp.entryDeadline && comp.entryDeadline < new Date()) {
    return NextResponse.json({ error: "DEADLINE_PASSED", message: "Entry deadline has passed." }, { status: 409 });
  }

  const rider = await prisma.rider.findUnique({ where: { id: d.riderId } });
  if (!rider || rider.centreId !== comp.centreId) {
    return NextResponse.json({ error: "INVALID_RIDER" }, { status: 400 });
  }

  // Federation eligibility gate. Competitions with scope=state/national
  // require the rider to hold an active accreditation from a recognised
  // body. "internal" + "inter_school" scopes are always allowed. The
  // check is conservative — if accreditations module isn't enabled or
  // no accreditation rows exist, we surface a clear error rather than
  // silently letting the entry through.
  if (comp.scope === "state" || comp.scope === "national") {
    const now = new Date();
    const valid = await prisma.accreditation.findFirst({
      where: {
        riderId: rider.id,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, body: true, title: true, expiresAt: true },
    });
    if (!valid) {
      return NextResponse.json(
        {
          error: "ACCREDITATION_REQUIRED",
          message: `${rider.firstName} ${rider.lastName} has no active federation accreditation. ${comp.scope === "national" ? "National" : "State"}-scope competitions require one (EFI / BHS / FEI).`,
          riderId: rider.id,
          scope: comp.scope,
        },
        { status: 409 },
      );
    }
  }

  if (d.horseId) {
    const horse = await prisma.horse.findUnique({ where: { id: d.horseId } });
    if (!horse || horse.centreId !== comp.centreId) {
      return NextResponse.json({ error: "INVALID_HORSE" }, { status: 400 });
    }
    if (horse.status !== "active") {
      return NextResponse.json({ error: "HORSE_NOT_AVAILABLE", message: `${horse.name} is ${horse.status}.` }, { status: 409 });
    }
    // C9: same horse in another non-withdrawn entry within this competition
    // is a soft conflict. Pass `allowDoubleBook: true` to override after a
    // manager confirms.
    if (!d.allowDoubleBook) {
      const conflict = await prisma.competitionEntry.findFirst({
        where: {
          competitionId: comp.id,
          horseId: d.horseId,
          status: { not: "withdrawn" },
        },
        select: { className: true, rider: { select: { firstName: true, lastName: true } } },
      });
      if (conflict) {
        return NextResponse.json(
          {
            error: "HORSE_DOUBLE_BOOKED",
            detail: `${horse.name} is already entered in ${conflict.className} with ${conflict.rider.firstName} ${conflict.rider.lastName}.`,
          },
          { status: 409 },
        );
      }
    }
  }

  if (d.teamId) {
    const team = await prisma.team.findUnique({ where: { id: d.teamId } });
    if (!team || team.centreId !== comp.centreId) {
      return NextResponse.json({ error: "INVALID_TEAM" }, { status: 400 });
    }
  }

  if (cls.maxEntries) {
    const filled = await prisma.competitionEntry.count({
      where: { competitionId: comp.id, className: d.className, status: { not: "withdrawn" } },
    });
    if (filled >= cls.maxEntries) {
      return NextResponse.json({ error: "CLASS_FULL", message: `${d.className} is full (${cls.maxEntries}).` }, { status: 409 });
    }
  }

  // Fee-collection master switch. When OFF for this centre's org, treat
  // every entry as free at the entry-row level + skip invoice creation.
  // Class.fee in the source data stays untouched so toggling fees back
  // ON later resumes invoicing without a migration.
  const feesOn = await isFeatureEnabledForCentre(comp.centreId, "fee-collection");
  const billable = feesOn && cls.fee > 0;

  try {
    const entry = await prisma.competitionEntry.create({
      data: {
        competitionId: comp.id,
        riderId: rider.id,
        className: d.className,
        horseId: d.horseId || null,
        teamId: d.teamId || null,
        notes: d.notes || null,
        paid: !billable,
      },
    });

    // Create an invoice only when fees are on AND the class is billable.
    let invoiceId: string | null = null;
    if (billable) {
      const inv = await prisma.invoice.create({
        data: {
          centreId: comp.centreId,
          riderId: rider.id,
          amount: cls.fee,
          dueDate: comp.entryDeadline ?? new Date(Date.now() + 7 * 86400000),
          kind: "event",
          status: "due",
        },
      });
      invoiceId = inv.id;
    }

    await audit({
      userId: session.userId,
      action: "competition.enter",
      tableName: "competitionEntry",
      rowId: entry.id,
      after: { competitionId: comp.id, className: d.className, riderId: rider.id, invoiceId },
    });

    return NextResponse.json({ id: entry.id, invoiceId });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "DUPLICATE_ENTRY", message: "Rider is already entered in this class." }, { status: 409 });
    }
    throw err;
  }
}
