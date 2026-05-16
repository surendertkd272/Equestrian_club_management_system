import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";

// POST /api/tickets/check-in — gate-side scanner posts the ticket id
// (from the QR). We:
//   • verify the ticket is paid + not voided
//   • flip checkedInAt to "now" if not already
//   • return the ticket's friendly metadata so the scanner UI can
//     show a quick "Bina, Day pass · 4th adult check-in" confirmation
//
// Idempotent: a second scan of the same ticket returns ALREADY_CHECKED_IN
// with the original timestamp, so duplicate scans don't move the needle.
const schema = z.object({ ticketId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const ticket = await prisma.ticket.findUnique({
    where: { id: parsed.data.ticketId },
    include: {
      competition: { select: { id: true, centreId: true, name: true } },
      tier: { select: { name: true, priceInr: true } },
    },
  });
  if (!ticket) return NextResponse.json({ error: "TICKET_NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && ticket.competition.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (ticket.status === "voided") {
    return NextResponse.json({ error: "VOIDED", buyerName: ticket.buyerName }, { status: 409 });
  }
  if (!ticket.paidAt && ticket.tier.priceInr > 0) {
    return NextResponse.json({ error: "NOT_PAID", buyerName: ticket.buyerName }, { status: 409 });
  }
  if (ticket.checkedInAt) {
    return NextResponse.json({
      error: "ALREADY_CHECKED_IN",
      buyerName: ticket.buyerName,
      tierName: ticket.tier.name,
      at: ticket.checkedInAt,
    }, { status: 409 });
  }

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: { checkedInAt: new Date(), checkedInBy: session.userId },
  });
  await audit({
    userId: session.userId,
    action: "ticket.checked_in",
    tableName: "ticket",
    rowId: ticket.id,
    after: { buyerName: ticket.buyerName, tierName: ticket.tier.name },
  });

  return NextResponse.json({
    ok: true,
    buyerName: ticket.buyerName,
    buyerEmail: ticket.buyerEmail,
    tierName: ticket.tier.name,
    competitionName: ticket.competition.name,
  });
}
