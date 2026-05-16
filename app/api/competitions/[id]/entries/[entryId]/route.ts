import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateEntrySchema } from "@/lib/schemas/competition";
import { audit } from "@/lib/audit";
import { generateUniqueSerial, verifyUrl } from "@/lib/cert";

export async function PATCH(req: NextRequest, { params }: { params: { id: string; entryId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = updateEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const entry = await prisma.competitionEntry.findUnique({
    where: { id: params.entryId },
    include: { competition: true },
  });
  if (!entry || entry.competitionId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (session.role !== "SUPER_ADMIN" && entry.competition.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  // Enforce 1st/2nd/3rd uniqueness per (competition, class).
  if (parsed.data.placement) {
    const clash = await prisma.competitionEntry.findFirst({
      where: {
        competitionId: entry.competitionId,
        className: entry.className,
        placement: parsed.data.placement,
        id: { not: entry.id },
      },
      select: { id: true, riderId: true },
    });
    if (clash) {
      return NextResponse.json(
        { error: "PLACEMENT_TAKEN", message: `Position ${parsed.data.placement} in ${entry.className} is already taken — clear it first.` },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.competitionEntry.update({
    where: { id: entry.id },
    data: {
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.placement !== undefined ? { placement: parsed.data.placement } : {}),
      ...(parsed.data.score !== undefined ? { score: parsed.data.score } : {}),
      ...(parsed.data.faults !== undefined ? { faults: parsed.data.faults } : {}),
      ...(parsed.data.time !== undefined ? { time: parsed.data.time } : {}),
      ...(parsed.data.teamId !== undefined ? { teamId: parsed.data.teamId || null } : {}),
      ...(parsed.data.paid !== undefined ? { paid: parsed.data.paid } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
    },
  });

  // C8: handle a transition into "withdrawn". If a fee invoice exists for
  // this rider/centre keyed to a competition entry and isn't yet paid, we
  // void it; if it was paid, we mark it refunded and create an audit trail.
  // The invoice→entry link is implicit (kind="event", same rider+centre,
  // due date matches comp deadline). We pick the latest matching invoice.
  if (parsed.data.status === "withdrawn" && entry.status !== "withdrawn") {
    const invoice = await prisma.invoice.findFirst({
      where: {
        centreId: entry.competition.centreId,
        riderId: entry.riderId,
        kind: "event",
        status: { in: ["due", "paid"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (invoice) {
      const wasPaid = invoice.status === "paid";
      const refunded = await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "refunded" },
      });
      // For a PAID invoice we must also book a negative-amount Payment
      // row so the finance dashboard income totals balance — otherwise
      // the original cash-in remains counted indefinitely. Voided due
      // invoices need no payment counter since nothing came in.
      if (wasPaid) {
        const paymentsSum = await prisma.payment.aggregate({
          where: { invoiceId: invoice.id },
          _sum: { amount: true },
        });
        const reverseAmount = paymentsSum._sum.amount ?? invoice.amount;
        if (reverseAmount > 0) {
          await prisma.payment.create({
            data: {
              invoiceId: invoice.id,
              amount: -reverseAmount,
              method: "bank",
              txnRef: `refund:entry:${entry.id}`,
              paidAt: new Date(),
              clearedAt: new Date(),
            },
          });
        }
      }
      await prisma.competitionEntry.update({
        where: { id: entry.id },
        data: { refundedAt: new Date(), refundInvoiceId: invoice.id },
      });
      await audit({
        userId: session.userId,
        action: wasPaid ? "competition.entry_refunded" : "competition.entry_voided",
        tableName: "invoice",
        rowId: refunded.id,
        before: { status: invoice.status, amount: invoice.amount },
        after: { status: refunded.status, entryId: entry.id, reverseBooked: wasPaid },
      });
    }
  }

  await audit({
    userId: session.userId,
    action: "competition.result_update",
    tableName: "competitionEntry",
    rowId: entry.id,
    before: { placement: entry.placement, score: entry.score, status: entry.status },
    after: { placement: updated.placement, score: updated.score, status: updated.status },
  });

  // C7: auto-issue a winner certificate when an entry first lands a top-3
  // placement. Skip if the rider already has a winner cert for this
  // (competition, class) — covers PATCH idempotency and accidental re-saves.
  if (
    parsed.data.placement &&
    parsed.data.placement <= 3 &&
    entry.placement !== parsed.data.placement
  ) {
    const exists = await prisma.certificate.findFirst({
      where: {
        competitionId: entry.competitionId,
        riderId: entry.riderId,
        type: "winner",
        levelName: { contains: entry.className },
      },
      select: { id: true },
    });
    if (!exists) {
      const serial = await generateUniqueSerial(parsed.data.placement);
      const placeLabel =
        parsed.data.placement === 1 ? "1st place" : parsed.data.placement === 2 ? "2nd place" : "3rd place";
      const cert = await prisma.certificate.create({
        data: {
          centreId: entry.competition.centreId,
          riderId: entry.riderId,
          competitionId: entry.competitionId,
          type: "winner",
          levelName: `${placeLabel} · ${entry.className}`,
          serialNo: serial,
          qrCode: verifyUrl(serial),
          signedBy: session.userId,
        },
      });
      await audit({
        userId: session.userId,
        action: "certificate.auto_issue_winner",
        tableName: "certificate",
        rowId: cert.id,
        after: { competitionId: entry.competitionId, riderId: entry.riderId, placement: parsed.data.placement },
      });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; entryId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const entry = await prisma.competitionEntry.findUnique({
    where: { id: params.entryId },
    include: { competition: { select: { centreId: true } } },
  });
  if (!entry || entry.competitionId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (session.role !== "SUPER_ADMIN" && entry.competition.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  await prisma.competitionEntry.delete({ where: { id: entry.id } });
  await audit({ userId: session.userId, action: "delete", tableName: "competitionEntry", rowId: entry.id, before: entry });
  return NextResponse.json({ ok: true });
}
