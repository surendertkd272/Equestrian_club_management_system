import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabledForCentre } from "@/lib/features-gate";

const MockBody = z.object({ invoiceId: z.string().cuid() });

// Dev-only mock. Unauthenticated + no signature check — if reachable in
// production, anyone can mark any invoice paid by sending a single POST.
// Hard-gate on NODE_ENV here so a missed middleware change can't expose
// it; replace with the verified Razorpay webhook in prod.
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "NOT_AVAILABLE" }, { status: 404 });
  }
  const parsed = MockBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invoiceId required" }, { status: 400 });
  const { invoiceId } = parsed.data;

  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!(await isFeatureEnabledForCentre(invoice.centreId, "fee-collection"))) {
    return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 503 });
  }

  await prisma.$transaction([
    prisma.payment.create({
      data: {
        invoiceId,
        amount: invoice.amount,
        method: "razorpay",
        txnRef: `MOCK_${Date.now()}`,
        clearedAt: new Date(),
      },
    }),
    prisma.invoice.update({ where: { id: invoiceId }, data: { status: "paid" } }),
    prisma.rider.update({
      where: { id: invoice.riderId },
      data: { registrationPaid: true, status: "active" },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
