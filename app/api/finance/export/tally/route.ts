import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { wallPartsInTz, startOfDayInTz, endOfDayInTz, parseWallTimeInTz } from "@/lib/tz";
import { getOrgIdForSession } from "@/lib/features-gate";
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

// Tally wants YYYYMMDD — in the CLUB's calendar, not the server's. Vercel runs
// UTC and the clubs run Asia/Kolkata (+5:30), so anything a club did after
// 18:30 local was stamped with the previous day: a payment taken on the 1st
// filed into the previous month's books, and the month's takings never
// reconciled at either boundary.
function ddmmyyyy(d: Date, timeZone: string): string {
  return wallPartsInTz(d, timeZone).date.replace(/-/g, "");
}

/** The club calendar this export is expressed in. */
async function exportTimeZone(centreId: string | null, orgId: string | null): Promise<string> {
  const c = centreId
    ? await prisma.centre.findUnique({ where: { id: centreId }, select: { timezone: true } })
    : orgId
      ? await prisma.centre.findFirst({ where: { orgId }, select: { timezone: true }, orderBy: { id: "asc" } })
      : null;
  return c?.timezone ?? "Asia/Kolkata";
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "finance.read")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  // ADMIN is an HQ role with no centre of its own, so the old
  // `!centreId && role !== SUPER_ADMIN` gate refused the org's finance lead
  // outright. HQ is allowed; it is scoped to their organisation below.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!session.centreId && !isHQ) {
    return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  }
  // ...and an HQ caller must be bound to their OWN organisation. The scope was
  // `session.centreId ? { centreId } : {}` — an EMPTY filter for a centre-less
  // caller, so the export swept every centre in every tenant on the platform
  // into one club's books.
  const callerOrg = isHQ ? await getOrgIdForSession(session) : null;
  if (isHQ && !callerOrg) {
    return NextResponse.json(
      { error: "NO_ORG", message: "Your account isn't bound to an organisation, so there is nothing to export." },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  // The requested window is a range of CLUB days. Parsed as UTC it started and
  // ended 5.5 hours early, so each end of the range caught the wrong evening.
  const scopeTz = await exportTimeZone(session.centreId, callerOrg);
  const from = fromStr
    ? startOfDayInTz(parseWallTimeInTz(`${fromStr}T00:00`, scopeTz), scopeTz)
    : new Date(Date.now() - 30 * 86400000);
  const to = toStr
    ? endOfDayInTz(parseWallTimeInTz(`${toStr}T00:00`, scopeTz), scopeTz)
    : new Date();

  const where = session.centreId ? { centreId: session.centreId } : { centre: { orgId: callerOrg! } };

  const [invoices, payments, expenses, centre, salaries] = await Promise.all([
    prisma.invoice.findMany({
      // Voided invoices never happened as far as the books are concerned —
      // exporting one posts fee income and Output GST for a charge the club
      // withdrew, which is a statutory filing error, not a cosmetic one.
      //
      // A credit note whose ORIGINAL was later voided goes with it. Otherwise
      // the batch carries a Credit Note voucher reversing a Sales voucher that
      // is no longer in the export, so the books show a credit against nothing.
      where: {
        ...where,
        voidedAt: null,
        createdAt: { gte: from, lte: to },
        OR: [{ creditNoteForId: null }, { creditNoteFor: { voidedAt: null } }],
      },
      include: { rider: { select: { firstName: true, lastName: true } }, creditNoteFor: { select: { kind: true } } },
      orderBy: { createdAt: "asc" },
      take: 5000,
    }),
    prisma.payment.findMany({
      // Same rule for receipts: nothing belonging to a voided invoice.
      // Void is only permitted once payments net to zero, so a voided invoice's
      // receipt and its reversal always leave together — the books never lose
      // one half of a pair. (An invoice voided AFTER an earlier export is the
      // exception; the reversal is reported in the response so the operator
      // can post it by hand.)
      where: { paidAt: { gte: from, lte: to }, invoice: { ...where, voidedAt: null } },
      include: { invoice: { include: { rider: { select: { firstName: true, lastName: true } } } } },
      orderBy: { paidAt: "asc" },
      take: 5000,
    }),
    // Select each expense on the SAME axis it is posted on, or vouchers fall
    // outside the window they were asked for. A bill spent in June and paid in
    // July was selected by the June query and then dated 20 July — twenty days
    // past the end of the requested range — so a month's export contained
    // vouchers belonging to the next month and omitted ones belonging to it.
    //   paid   → a Payment voucher dated paidAt   → select on paidAt
    //   unpaid → a Journal accrual dated spentAt  → select on spentAt
    prisma.expense.findMany({
      where: {
        ...where,
        OR: [
          { paid: true, paidAt: { gte: from, lte: to } },
          { paid: false, spentAt: { gte: from, lte: to } },
        ],
      },
      include: { vendor: { select: { name: true } }, category: { select: { name: true } } },
      orderBy: { spentAt: "asc" },
      take: 5000,
    }),
    session.centreId
      ? prisma.centre.findUnique({ where: { id: session.centreId }, select: { name: true } })
      : Promise.resolve(null),
    // Salaries. Payroll was absent from this export entirely, so the single
    // largest cash outflow a club has — ₹76,500 in one month of the sandbox —
    // simply did not exist in the books the accountant hands to Tally. Only
    // rows that have actually been PAID belong in a cash export.
    prisma.salaryPayment.findMany({
      // A voided run is not a payment — it must not reach the books.
      where: { ...where, voidedAt: null, paidAt: { gte: from, lte: to } },
      include: { user: { select: { name: true } } },
      orderBy: { paidAt: "asc" },
      take: 5000,
    }),
  ]);

  // Map a payment method to the ledger the money actually moved through.
  // Shared by receipts, expenses and salaries so the three can't drift.
  const ledgerForMethod = (m: string | null | undefined): string =>
    m === "cash" ? "Cash" :
    m === "cheque" ? "Bank - Cheque" :
    m === "upi" ? "Bank - UPI" :
    m === "razorpay" ? "Bank - Razorpay" :
    m === "card" ? "Bank - Card" :
    "Bank";

  // Every row is dated in ITS OWN centre's timezone — an org can span zones.
  const tzRows = await prisma.centre.findMany({
    where: session.centreId ? { id: session.centreId } : { orgId: callerOrg! },
    select: { id: true, timezone: true },
  });
  const tzByCentre = new Map(tzRows.map((c) => [c.id, c.timezone]));
  const tzFor = (centreId: string | null | undefined) =>
    (centreId && tzByCentre.get(centreId)) || scopeTz;

  const vouchers: string[] = [];

  // Sales Vouchers — one per Invoice. Tally requires a `LEDGERNAME` pair:
  // the customer ledger (debit) + the income ledger (credit). We emit
  // generic ledger names that accountants typically pre-create in Tally;
  // if your books use different names, search-replace post-export.
  for (const inv of invoices) {
    const party = `${inv.rider.firstName} ${inv.rider.lastName}`;
    // A credit note is a NEGATIVE Invoice row. Emitting it as a Sales voucher
    // produced `<AMOUNT>--6800.00</AMOUNT>` (a double minus Tally rejects) and
    // dropped the GST leg entirely, because that leg was gated on
    // `gstAmount > 0`. Post it as a proper Credit Note voucher with positive
    // magnitudes and the debit/credit sides swapped, under the ORIGINAL
    // invoice's income ledger so the reversal lands where the charge did.
    const isCredit = inv.creditNoteForId != null;
    const net = Math.abs(inv.amount);
    const gst = Math.abs(inv.gstAmount);
    const total = net + gst;
    const kind = isCredit ? inv.creditNoteFor?.kind ?? inv.kind : inv.kind;
    const vchType = isCredit ? "Credit Note" : "Sales";
    const label = isCredit ? "Credit note" : "Invoice";
    vouchers.push(
      `<VOUCHER VCHTYPE="${vchType}" ACTION="Create">
  <DATE>${ddmmyyyy(inv.createdAt, tzFor(inv.centreId))}</DATE>
  <NARRATION>${escapeXml(`${label} #${inv.id.slice(-8)} · ${kind} fee · ${party}`)}</NARRATION>
  <VOUCHERTYPENAME>${vchType}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${escapeXml(inv.id.slice(-12).toUpperCase())}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${escapeXml(party)}</PARTYLEDGERNAME>
  <BASICBASEPARTYNAME>${escapeXml(party)}</BASICBASEPARTYNAME>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(party)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>${isCredit ? "No" : "Yes"}</ISDEEMEDPOSITIVE>
    <AMOUNT>${isCredit ? "" : "-"}${total.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(`Fee Income - ${kind}`)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>${isCredit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
    <AMOUNT>${isCredit ? "-" : ""}${net.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${gst > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Output GST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>${isCredit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
    <AMOUNT>${isCredit ? "-" : ""}${gst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>` : ""}
</VOUCHER>`,
    );
  }

  // Receipt Vouchers — one per Payment. Bank/cash ledger debited, party
  // ledger credited.
  for (const p of payments) {
    const partyLedger = `${p.invoice.rider.firstName} ${p.invoice.rider.lastName}`;
    const bankLedger = ledgerForMethod(p.method);
    // A reversal is a negative Payment row (bounced cheque, refund, receipt
    // entered against the wrong rider). Emitted as a Receipt it produced
    // `--11800.00`; it belongs in the books as a Payment voucher with the
    // bank and party sides swapped.
    const isReversal = p.amount < 0;
    const magnitude = Math.abs(p.amount);
    const vchType = isReversal ? "Payment" : "Receipt";
    vouchers.push(
      `<VOUCHER VCHTYPE="${vchType}" ACTION="Create">
  <DATE>${ddmmyyyy(p.paidAt, tzFor(p.invoice.centreId))}</DATE>
  <NARRATION>${escapeXml(
    isReversal
      ? `Reversal of payment on invoice #${p.invoiceId.slice(-8)} · ${p.reason ?? "reversed"}`
      : `Payment for invoice #${p.invoiceId.slice(-8)} · ref ${p.txnRef ?? "—"}`,
  )}</NARRATION>
  <VOUCHERTYPENAME>${vchType}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${escapeXml(p.id.slice(-12).toUpperCase())}</VOUCHERNUMBER>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(bankLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>${isReversal ? "No" : "Yes"}</ISDEEMEDPOSITIVE>
    <AMOUNT>${isReversal ? "" : "-"}${magnitude.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(partyLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>${isReversal ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
    <AMOUNT>${isReversal ? "-" : ""}${magnitude.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>`,
    );
  }


  // Payment Vouchers — Expenses. Expense ledger debited; bank/cash credited.
  //
  // Three corrections here, all of which made the export disagree with the
  // club's actual books:
  //   • Input GST was dropped entirely — the credit side carried only the net
  //     amount, so recoverable tax vanished and the voucher didn't balance
  //     against a real bill.
  //   • The credit ledger was hard-coded to "Cash" no matter how the expense
  //     was actually settled, so bank and UPI spend was posted as cash out.
  //   • UNPAID expenses were exported as though the cash had already left. An
  //     accrued bill is a liability, not a payment, so it now posts against
  //     Sundry Creditors instead of a bank/cash ledger.
  for (const e of expenses) {
    const gross = e.amount + e.gstAmount;
    const creditLedger = e.paid ? ledgerForMethod(e.method) : "Sundry Creditors";
    vouchers.push(
      `<VOUCHER VCHTYPE="${e.paid ? "Payment" : "Journal"}" ACTION="Create">
  <DATE>${ddmmyyyy(e.paid && e.paidAt ? e.paidAt : e.spentAt, tzFor(e.centreId))}</DATE>
  <NARRATION>${escapeXml(`${e.category?.name ?? "Expense"} · ${e.vendor?.name ?? "—"} · ${e.description ?? ""}${e.paid ? "" : " [UNPAID — accrual]"}`)}</NARRATION>
  <VOUCHERTYPENAME>${e.paid ? "Payment" : "Journal"}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${escapeXml(e.id.slice(-12).toUpperCase())}</VOUCHERNUMBER>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(`Expense - ${e.category?.name ?? "General"}`)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${e.amount.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${e.gstAmount > 0 ? `<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Input GST</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${e.gstAmount.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ` : ""}<ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(creditLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${gross.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>`,
    );
  }

  // Payment Vouchers — Salaries. Gross debited to Salaries & Wages; the net
  // credited to the bank/cash ledger it was paid from; each deduction credited
  // to its own ledger so the voucher balances and the advance recovery is
  // visible in the books rather than only inside the payslip.
  for (const s of salaries) {
    // A voucher MUST balance or Tally rejects the entire import batch — so the
    // export derives the deduction total from the two figures that are
    // authoritative (what was earned, what was actually paid) and distributes
    // it across the ledgers in the stored proportions. Historic rows written
    // before the deduction was capped at gross would otherwise emit an
    // unbalanced voucher and take the whole month's import down with them.
    const rawDeductions: Array<[string, number]> = [
      ["Staff Advances", s.advanceDeducted],
      ["Salary Deductions - Attendance", s.attendanceDeducted],
      ["Salary Deductions - Other", s.otherDeductions],
    ].filter(([, v]) => (v as number) > 0) as Array<[string, number]>;
    const rawTotal = rawDeductions.reduce((t, [, v]) => t + v, 0);
    const mustTotal = Math.max(0, s.grossAmount - s.netAmount);
    const factor = rawTotal > 0 ? mustTotal / rawTotal : 0;
    const deductions: Array<[string, number]> = rawDeductions
      .map(([name, v]) => [name, v * factor] as [string, number])
      .filter(([, v]) => v > 0.005);
    vouchers.push(
      `<VOUCHER VCHTYPE="Payment" ACTION="Create">
  <DATE>${ddmmyyyy(s.paidAt!, tzFor(s.centreId))}</DATE>
  <NARRATION>${escapeXml(`Salary ${s.periodMonth} · ${s.user.name}${s.advanceDeducted > 0 ? ` · advance recovered ₹${s.advanceDeducted}` : ""}`)}</NARRATION>
  <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${escapeXml(s.id.slice(-12).toUpperCase())}</VOUCHERNUMBER>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Salaries &amp; Wages</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${s.grossAmount.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
${deductions.map(([name, amt]) => `  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(name)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${amt.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>`).join("\n")}
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${escapeXml(ledgerForMethod(s.method))}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${s.netAmount.toFixed(2)}</AMOUNT>
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

  // Rows this window deliberately leaves out. Voiding is only permitted while
  // payments net to zero, so a receipt and its reversal normally leave together
  // — but if the invoice was voided AFTER an earlier month was already filed,
  // the receipt is in Tally and its reversal silently is not. Say so in a
  // header rather than letting the books quietly drift.
  const droppedReversals = await prisma.payment.count({
    where: {
      paidAt: { gte: from, lte: to },
      amount: { lt: 0 },
      invoice: { ...where, voidedAt: { not: null } },
    },
  });

  const filename = `tally-${(centre?.name ?? "export").replace(/\W+/g, "-").toLowerCase()}-${fromStr ?? "30d"}-to-${toStr ?? "now"}.xml`;
  const headers: Record<string, string> = {
    "Content-Type": "application/xml; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Equiwings-Vouchers": String(vouchers.length),
  };
  if (droppedReversals > 0) {
    headers["X-Equiwings-Excluded-Reversals"] = String(droppedReversals);
    headers["X-Equiwings-Warning"] =
      `${droppedReversals} payment reversal(s) belong to invoices voided after an earlier export and are not included; post them by hand if that period was already filed.`;
  }
  return new NextResponse(xml, { headers });
}
