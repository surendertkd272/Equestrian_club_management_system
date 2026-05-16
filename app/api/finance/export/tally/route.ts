import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";

// GET /api/finance/export/tally?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Generates a Tally-ready XML voucher list for the centre's invoices +
// payments + expenses in the requested range. Tally ERP 9 / TallyPrime
// import this format directly via Gateway → Import Data → Vouchers.
//
// Format reference: Tally XML "Sales Voucher" + "Receipt Voucher" with
// inline LEDGERENTRIES. We only emit the minimum tags Tally requires;
// production accountants typically add COSTCENTRE, GST split, etc. — we
// leave hooks in the code below for that future work.

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ddmmyyyy(d: Date): string {
  // Tally wants YYYYMMDD.
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "finance.read")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  if (!session.centreId && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  }

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const from = fromStr ? new Date(`${fromStr}T00:00:00Z`) : new Date(Date.now() - 30 * 86400000);
  const to = toStr ? new Date(`${toStr}T23:59:59Z`) : new Date();

  const where = session.centreId ? { centreId: session.centreId } : {};

  const [invoices, payments, expenses, centre] = await Promise.all([
    prisma.invoice.findMany({
      where: { ...where, createdAt: { gte: from, lte: to } },
      include: { rider: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
      take: 5000,
    }),
    prisma.payment.findMany({
      where: { paidAt: { gte: from, lte: to }, invoice: where },
      include: { invoice: { include: { rider: { select: { firstName: true, lastName: true } } } } },
      orderBy: { paidAt: "asc" },
      take: 5000,
    }),
    prisma.expense.findMany({
      where: { ...where, spentAt: { gte: from, lte: to } },
      include: { vendor: { select: { name: true } }, category: { select: { name: true } } },
      orderBy: { spentAt: "asc" },
      take: 5000,
    }),
    session.centreId ? prisma.centre.findUnique({ where: { id: session.centreId }, select: { name: true } }) : Promise.resolve(null),
  ]);

  const vouchers: string[] = [];

  // Sales Vouchers — one per Invoice. Tally requires a `LEDGERNAME` pair:
  // the customer ledger (debit) + the income ledger (credit). We emit
  // generic ledger names that accountants typically pre-create in Tally;
  // if your books use different names, search-replace post-export.
  for (const inv of invoices) {
    const total = inv.amount + inv.gstAmount;
    vouchers.push(
      `<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${ddmmyyyy(inv.createdAt)}</DATE>
  <NARRATION>${escapeXml(`Invoice #${inv.id.slice(-8)} · ${inv.kind} fee · ${inv.rider.firstName} ${inv.rider.lastName}`)}</NARRATION>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${escapeXml(inv.id.slice(-12).toUpperCase())}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${escapeXml(`${inv.rider.firstName} ${inv.rider.lastName}`)}</PARTYLEDGERNAME>
  <BASICBASEPARTYNAME>${escapeXml(`${inv.rider.firstName} ${inv.rider.lastName}`)}</BASICBASEPARTYNAME>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(`${inv.rider.firstName} ${inv.rider.lastName}`)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${total.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(`Fee Income - ${inv.kind}`)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${inv.amount.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${inv.gstAmount > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Output GST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${inv.gstAmount.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>` : ""}
</VOUCHER>`,
    );
  }

  // Receipt Vouchers — one per Payment. Bank/cash ledger debited, party
  // ledger credited.
  for (const p of payments) {
    const partyLedger = `${p.invoice.rider.firstName} ${p.invoice.rider.lastName}`;
    const bankLedger =
      p.method === "cash" ? "Cash" :
      p.method === "cheque" ? "Bank - Cheque" :
      p.method === "upi" ? "Bank - UPI" :
      p.method === "razorpay" ? "Bank - Razorpay" :
      "Bank";
    vouchers.push(
      `<VOUCHER VCHTYPE="Receipt" ACTION="Create">
  <DATE>${ddmmyyyy(p.paidAt)}</DATE>
  <NARRATION>${escapeXml(`Payment for invoice #${p.invoiceId.slice(-8)} · ref ${p.txnRef ?? "—"}`)}</NARRATION>
  <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${escapeXml(p.id.slice(-12).toUpperCase())}</VOUCHERNUMBER>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(bankLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${p.amount.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(partyLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${p.amount.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>`,
    );
  }

  // Payment Vouchers — Expenses. Expense ledger debited; bank/cash credited.
  for (const e of expenses) {
    vouchers.push(
      `<VOUCHER VCHTYPE="Payment" ACTION="Create">
  <DATE>${ddmmyyyy(e.spentAt)}</DATE>
  <NARRATION>${escapeXml(`${e.category?.name ?? "Expense"} · ${e.vendor?.name ?? "—"} · ${e.description ?? ""}`)}</NARRATION>
  <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${escapeXml(e.id.slice(-12).toUpperCase())}</VOUCHERNUMBER>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(`Expense - ${e.category?.name ?? "General"}`)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${e.amount.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Cash</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${e.amount.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>`,
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${escapeXml(centre?.name ?? "Equiwings")}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        ${vouchers.map((v) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${v}</TALLYMESSAGE>`).join("\n")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

  const filename = `tally-${(centre?.name ?? "export").replace(/\W+/g, "-").toLowerCase()}-${fromStr ?? "30d"}-to-${toStr ?? "now"}.xml`;
  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
