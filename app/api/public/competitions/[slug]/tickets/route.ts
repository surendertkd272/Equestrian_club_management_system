import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { verifyChallenge } from "@/lib/captcha";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { createOrder, isConfigured } from "@/lib/razorpay";
import { sendEmail, renderEmail } from "@/lib/email";

// POST /api/public/competitions/[slug]/tickets — public ticket purchase.
//
// Two paths:
//   • Free tier (priceInr === 0): instantly issues the Ticket rows + emails QR.
//   • Paid tier: creates a Razorpay order, returns orderId + keyId; the
//     client opens Razorpay checkout, completes payment, and the webhook
//     at /api/webhooks/razorpay flips the tickets to paid + emails QRs.
//
// Capacity is enforced at submission time: if the tier's `capacity` is
// finite and would be exceeded, we 409 before touching Razorpay.

const buySchema = z.object({
  tierId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(20),
  buyerName: z.string().min(1).max(120),
  buyerEmail: z.string().email(),
  buyerPhone: z.string().min(7).max(20).optional().or(z.literal("")),
  captchaToken: z.string().min(1),
  captchaAnswer: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const ip = clientFingerprint(req);
  const rl = checkRate(`public-ticket:${ip}`, 15, 60 * 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = buySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  if (!verifyChallenge(d.captchaToken, d.captchaAnswer)) {
    return NextResponse.json({ error: "CAPTCHA_FAILED" }, { status: 400 });
  }

  const tier = await prisma.ticketTier.findUnique({
    where: { id: d.tierId },
    include: { competition: { select: { id: true, slug: true, name: true, status: true } } },
  });
  if (!tier || tier.competition.slug !== params.slug) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (!tier.active || tier.competition.status === "cancelled" || tier.competition.status === "draft") {
    return NextResponse.json({ error: "NOT_ON_SALE" }, { status: 409 });
  }

  // Capacity check (idempotent — we count active tickets, including any
  // pending paid ones; the webhook never double-issues).
  if (tier.capacity !== null) {
    const issued = await prisma.ticket.count({
      where: { tierId: tier.id, status: "issued" },
    });
    if (issued + d.quantity > tier.capacity) {
      return NextResponse.json({ error: "SOLD_OUT", remaining: Math.max(0, tier.capacity - issued) }, { status: 409 });
    }
  }

  const groupId = crypto.randomUUID();
  const totalInr = tier.priceInr * d.quantity;

  if (tier.priceInr === 0) {
    // Free tier — issue immediately.
    await prisma.ticket.createMany({
      data: Array.from({ length: d.quantity }).map(() => ({
        competitionId: tier.competition.id,
        tierId: tier.id,
        buyerName: d.buyerName,
        buyerEmail: d.buyerEmail.toLowerCase(),
        buyerPhone: d.buyerPhone || null,
        groupId,
        paidAt: new Date(),
      })),
    });
    const tickets = await prisma.ticket.findMany({ where: { groupId }, select: { id: true } });
    await sendQrEmail({
      to: d.buyerEmail,
      name: d.buyerName,
      competitionName: tier.competition.name,
      tierName: tier.name,
      quantity: d.quantity,
      ticketIds: tickets.map((t) => t.id),
      compSlug: tier.competition.slug,
    });
    return NextResponse.json({ ok: true, free: true, groupId });
  }

  // Paid tier — Razorpay path.
  if (!isConfigured()) {
    return NextResponse.json({ error: "RAZORPAY_NOT_CONFIGURED" }, { status: 503 });
  }

  // Persist tickets as pending (paidAt=null) so the webhook can find them.
  await prisma.ticket.createMany({
    data: Array.from({ length: d.quantity }).map(() => ({
      competitionId: tier.competition.id,
      tierId: tier.id,
      buyerName: d.buyerName,
      buyerEmail: d.buyerEmail.toLowerCase(),
      buyerPhone: d.buyerPhone || null,
      groupId,
    })),
  });

  let order;
  try {
    order = await createOrder({
      amountPaise: totalInr * 100,
      receipt: `tkt_${groupId.slice(0, 24)}`,
      notes: { kind: "ticket", groupId, competitionId: tier.competition.id, tierId: tier.id },
    });
  } catch (err) {
    return NextResponse.json({ error: "PROVIDER_ERROR", message: (err as Error).message }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    free: false,
    groupId,
    orderId: order.id,
    keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    amountPaise: totalInr * 100,
    currency: "INR",
    name: tier.competition.name,
    description: `${d.quantity} × ${tier.name}`,
    prefill: { name: d.buyerName, email: d.buyerEmail, contact: d.buyerPhone || "" },
  });
}

async function sendQrEmail(opts: {
  to: string;
  name: string;
  competitionName: string;
  tierName: string;
  quantity: number;
  ticketIds: string[];
  compSlug: string;
}) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const ticketLinks = opts.ticketIds
    .map((id) => `<li><a href="${base}/tickets/${id}">View ticket (open this on your phone)</a></li>`)
    .join("");
  await sendEmail({
    to: opts.to,
    subject: `Your tickets · ${opts.competitionName}`,
    html: renderEmail({
      centreName: "Equiwings",
      heading: "Your tickets are ready",
      body: `<p>Hi ${opts.name},</p>
<p>You have <strong>${opts.quantity}</strong> × <strong>${opts.tierName}</strong> for <strong>${opts.competitionName}</strong>.</p>
<p>Open each ticket on your phone at the gate — the QR code is scanned in.</p>
<ul style="line-height:1.8">${ticketLinks}</ul>`,
    }),
    ref: { type: "tickets.issued", rowId: opts.ticketIds[0] ?? "—" },
  });
}
