import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { getOrgIdForSession } from "@/lib/features-gate";

// Void a batch of invoices that should never have existed.
//
// The case this was built for: a club had fee-collection switched on when it
// should not have been, so every approved rider was issued a registration
// invoice. Ninety-seven of them, none ever paid, all now sitting in the books
// as outstanding money nobody intends to collect. Voiding them one at a time
// is ninety-seven clicks, and doing it in raw SQL writes no audit entry —
// which for a couple of lakh of write-offs is the wrong trade.
//
// Same rules as the single void, applied per row rather than relaxed:
//   • never touches an invoice with a payment against it — that is a real
//     event, and erasing it would leave the family's money pointing at
//     nothing. Those need a credit note instead.
//   • never re-voids something already void.
//   • org-fenced, so a batch cannot reach another tenant's ledger.
//
// NOT gated on the fee-collection feature: switching it off is precisely when
// this is needed.

const schema = z.object({
  centreId: z.string().optional(),
  reason: z.string().min(3).max(300),
  status: z.enum(["due", "overdue"]).default("due"),
  /** Count and total without writing anything. */
  dryRun: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // Writing off money is a finance act, not an admin convenience.
  if (!can(session.role, "finance.write")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: "A reason is required to void invoices." },
      { status: 400 },
    );
  }
  const d = parsed.data;

  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });

  // Centre-scoped when asked, org-scoped otherwise — never unbounded. A
  // centre-tier caller is pinned to their own centre regardless of what they
  // send.
  const centreFilter =
    session.centreId != null
      ? { centreId: session.centreId }
      : d.centreId
        ? { centreId: d.centreId }
        : { centre: { orgId } };

  const targets = await prisma.invoice.findMany({
    where: {
      ...centreFilter,
      status: d.status,
      voidedAt: null,
      // A credit note is not a bill and must not be voided as one.
      creditNoteForId: null,
      payments: { none: {} },
      // Belt and braces: even a supplied centreId must be inside the org.
      centre: { orgId },
    },
    select: { id: true, amount: true, centreId: true, riderId: true },
  });

  const total = targets.reduce((t, i) => t + i.amount, 0);
  if (d.dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, count: targets.length, total });
  }
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, count: 0, total: 0 });
  }

  const now = new Date();
  await prisma.invoice.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: {
      status: "void",
      voidedAt: now,
      voidedByUserId: session.userId,
      voidReason: d.reason,
    },
  });

  // One audit row per invoice, not one for the batch. A write-off has to be
  // traceable per document — "97 voided" tells you nothing when someone asks
  // about one specific rider's invoice two years from now.
  await audit({
    userId: session.userId,
    action: "invoice.bulk_void",
    tableName: "invoice",
    rowId: orgId,
    after: {
      count: targets.length,
      total,
      reason: d.reason,
      invoiceIds: targets.map((t) => t.id),
    },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, count: targets.length, total });
}
