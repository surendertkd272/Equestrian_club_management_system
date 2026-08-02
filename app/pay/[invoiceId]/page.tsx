// Public payment surface. Parent lands here from the email link sent on
// approval — no auth required. The invoice ID is a cuid (~25 chars of
// entropy); unguessable by brute force, but we still gate the lookup
// behind a rate-limit to make a scan-attack expensive on top of slow.
//
// Renders the invoice summary + a "Pay now" button that opens the
// Razorpay modal. Payment success is detected via the webhook (which
// flips invoice.status and rider.status server-side), so this page
// shows a "paid" state both when the user just paid AND when they
// reload an old link after paying.

import Link from "next/link";
import { supportEmailFor } from "@/lib/contact";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabledForCentre } from "@/lib/features-gate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PayButton } from "./pay-button";
import { bindRlsBypass } from "@/lib/tenant-context";
import { formatEnum } from "@/lib/labels";
import { creditPosition } from "@/lib/credit-note";
import { PLATFORM_TZ } from "@/lib/tz";
export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: { invoiceId: string } }) {
  bindRlsBypass(); // public-by-unguessable-id flow (no session to bind an org from)
  const invoice = await prisma.invoice.findUnique({
    where: { id: params.invoiceId },
    include: {
      centre: { select: { name: true, org: { select: { supportEmail: true } } } },
      rider: { select: { firstName: true, lastName: true } },
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true, gstAmount: true } },
    },
  });
  if (!invoice) notFound();
  // Fee-collection master switch — if the tenant turned payments off after
  // this invoice was created, the link 404s. Records stay in the DB for
  // audit; only the surface disappears.
  if (!(await isFeatureEnabledForCentre(invoice.centreId, "fee-collection"))) {
    notFound();
  }

  // What the family actually owes: face value, less anything credited back,
  // less what they have already paid. Quoting the face value asked a family to
  // pay a charge the club had partly cancelled — and the Pay button honoured it.
  const position = creditPosition(invoice);
  const total = position.outstanding;
  const paid = position.outstanding <= 0.001;
  // A charge the centre cancelled must not keep presenting a Pay button to the
  // family. The API refuses the payment now, but a live "Pay ₹23,600" screen on
  // a cancelled invoice is its own harm — parents chase it, and the club has to
  // explain. Credit notes are never payable either.
  const cancelled = !!invoice.voidedAt || !!invoice.creditNoteForId;

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="mb-6 text-center">
          {/* Public surface — no logged-in shell, so we render our own header. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/equiwings-logo.png" alt="Equiwings" className="mx-auto h-10 w-auto" />
          <div className="mt-1 text-sm text-muted-foreground">{invoice.centre.name}</div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {paid ? "Payment received" : "Pay registration fee"}
            </CardTitle>
            <CardDescription>
              {invoice.rider.firstName} {invoice.rider.lastName}
              {" · "}
              {formatEnum(invoice.kind)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-md border bg-card p-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {cancelled ? "Cancelled" : "Amount due"}
                </div>
                <div className="text-3xl font-bold">₹{total.toLocaleString("en-IN")}</div>
                {position.creditable < position.face - 0.001 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    ₹{Math.round(position.face).toLocaleString("en-IN")} billed, less ₹
                    {Math.round(position.face - position.creditable).toLocaleString("en-IN")} credited
                  </div>
                )}
                {position.received > 0.001 && (
                  <div className="text-xs text-muted-foreground">
                    ₹{Math.round(position.received).toLocaleString("en-IN")} already received
                  </div>
                )}
              </div>
              {cancelled ? (
                <Badge variant="outline">Cancelled</Badge>
              ) : paid ? (
                <Badge variant="success">Paid</Badge>
              ) : (
                <Badge variant="warning">Pending</Badge>
              )}
            </div>

            {cancelled ? (
              <div className="rounded-md border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="font-semibold">This invoice has been cancelled.</div>
                <p className="mt-1">
                  {invoice.centre.name} withdrew this charge, so there is nothing to pay. If you were
                  expecting a bill, please contact the centre.
                </p>
              </div>
            ) : paid ? (
              <div className="rounded-md border-2 border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
                <div className="font-semibold">✓ This invoice has been paid.</div>
                <p className="mt-1">
                  Receipt was sent to the registered email on file. No action needed —
                  the rider's account is active.
                </p>
              </div>
            ) : (
              <>
                <PayButton
                  invoiceId={invoice.id}
                  centreName={invoice.centre.name}
                  amountRupees={total}
                />
                <p className="text-center text-xs text-muted-foreground">
                  Secure payment via Razorpay — UPI · Card · Netbanking. We never store card details.
                </p>
              </>
            )}

            <div className="border-t pt-3 text-center text-[11px] text-muted-foreground">
              Invoice <code className="font-mono">{invoice.id.slice(-10)}</code>
              {" · "}
              Created {invoice.createdAt.toLocaleDateString("en-IN", { timeZone: PLATFORM_TZ, day: "2-digit", month: "short", year: "numeric" })}
            </div>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Need help? Reach out to <b>{invoice.centre.name}</b> at{" "}
          <a href={`mailto:${supportEmailFor(invoice.centre.org)}`} className="underline">
            {supportEmailFor(invoice.centre.org)}
          </a>.
          {" "}
          <Link href="/login" className="underline">Staff sign in →</Link>
        </p>
      </div>
    </div>
  );
}
