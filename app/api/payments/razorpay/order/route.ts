import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createOrder, isConfigured, publicKeyId } from "@/lib/razorpay";
import { audit } from "@/lib/audit";
import { checkRate, clientFingerprint } from "@/lib/rate-limit";
import { isFeatureEnabledForCentre } from "@/lib/features-gate";
import { bindRlsBypass } from "@/lib/tenant-context";

// Public, unauthenticated — validate shape strictly before anything touches
// the DB. Invoice ids are Prisma cuid()s.
const OrderBody = z.object({ invoiceId: z.string().cuid() });

// Public endpoint — onboarding flow uses it without auth.
// Safety: caller must hand in a valid invoice CUID; we look it up to derive amount + rider context.
// The lookup response leaks rider name/email/mobile (Razorpay checkout
// prefill), so we throttle to slow invoice-ID enumeration attempts. A real
// onboarding flow needs at most a few calls per session; abusers hitting
// thousands of guesses run into 429s long before they enumerate anything.
export async function POST(req: NextRequest) {
  bindRlsBypass(); // public-by-unguessable-id flow (no session to bind an org from)
  if (!isConfigured()) {
    return NextResponse.json({ error: "RAZORPAY_NOT_CONFIGURED" }, { status: 503 });
  }

  const ip = clientFingerprint(req);
  const rl = checkRate(`razorpay:order:${ip}`, 30, 15 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = OrderBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
  const { invoiceId } = parsed.data;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      rider: { select: { firstName: true, lastName: true, email: true, mobile: true } },
      centre: { select: { name: true } },
    },
  });
  if (!invoice) return NextResponse.json({ error: "INVOICE_NOT_FOUND" }, { status: 404 });
  // Fee-collection master switch — refuse to mint an order for a tenant
  // that's turned rider payments off, even on a still-due invoice.
  if (!(await isFeatureEnabledForCentre(invoice.centreId, "fee-collection"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 503 });
  }
  if (invoice.status === "paid") {
    return NextResponse.json({ error: "ALREADY_PAID" }, { status: 409 });
  }  // A voided invoice is cancelled; a credit note is money owed the other way.
  // Minting a gateway order for either takes real money from a family for a
  // charge that no longer exists.
  if (invoice.voidedAt) {
    return NextResponse.json(
      { error: "INVOICE_VOID", message: "This invoice was cancelled by the centre. Nothing is payable." },
      { status: 409 },
    );
  }
  if (invoice.creditNoteForId) {
    return NextResponse.json({ error: "IS_CREDIT_NOTE" }, { status: 409 });
  }


  // Charge only the OUTSTANDING balance. An invoice can carry prior partial
  // payments (e.g. cash recorded manually) while still "due"; minting a
  // full-amount order would over-charge the parent at the gateway AND
  // over-count income once recorded.
  // Also net of credit notes. Charging the face value takes real money from a
  // family for a charge the club has already cancelled — the worst version of
  // this bug, because it happens at the gateway before anyone reviews it.
  const [paidAgg, creditAgg] = await Promise.all([
    prisma.payment.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } }),
    prisma.invoice.aggregate({ where: { creditNoteForId: invoice.id }, _sum: { amount: true, gstAmount: true } }),
  ]);
  const target =
    invoice.amount + invoice.gstAmount + (creditAgg._sum.amount ?? 0) + (creditAgg._sum.gstAmount ?? 0);
  const priorPaid = paidAgg._sum.amount ?? 0;
  const outstanding = target - priorPaid;
  if (outstanding <= 0) {
    return NextResponse.json({ error: "ALREADY_PAID" }, { status: 409 });
  }
  const amountPaise = Math.round(outstanding * 100);
  if (amountPaise <= 0) return NextResponse.json({ error: "INVALID_AMOUNT" }, { status: 400 });

  let order;
  try {
    order = await createOrder({
      amountPaise,
      // Razorpay receipt field has a 40-char limit; CUIDs are 25 chars so use directly.
      receipt: invoice.id,
      notes: {
        invoiceId: invoice.id,
        riderId: invoice.riderId,
        centreId: invoice.centreId,
        kind: invoice.kind,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "PROVIDER_ERROR", message: (err as Error).message },
      { status: 502 },
    );
  }

  await audit({
    action: "razorpay.order_created",
    tableName: "invoice",
    rowId: invoice.id,
    after: { orderId: order.id, amountPaise },
  });

  return NextResponse.json({
    orderId: order.id,
    keyId: publicKeyId(),
    amountPaise,
    currency: order.currency,
    name: invoice.centre.name,
    description: `${invoice.kind.replace("_", " ")} fee · ${invoice.rider.firstName} ${invoice.rider.lastName}`,
    prefill: {
      name: `${invoice.rider.firstName} ${invoice.rider.lastName}`,
      email: invoice.rider.email ?? "",
      contact: invoice.rider.mobile,
    },
  });
}
