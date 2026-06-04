import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Public ticket view. The URL is the ticket id — knowing the id IS the
// ticket. Anyone with the URL can show it at the gate. We deliberately
// don't gate by email/login because the spectator may not have an
// Equiwings account.
//
// The QR encodes the ticket id; the gate scanner POSTs to /api/tickets/check-in.
export default async function TicketPage({ params }: { params: { id: string } }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: params.id },
    include: {
      tier: { select: { name: true, priceInr: true } },
      competition: { select: { name: true, slug: true, startDate: true, venue: true } },
    },
  });
  if (!ticket) notFound();

  const qrSrc = `https://chart.googleapis.com/chart?cht=qr&chs=320x320&chl=${encodeURIComponent(ticket.id)}`;
  const checkedIn = !!ticket.checkedInAt;
  const voided = ticket.status === "voided";
  const pendingPayment = !ticket.paidAt && ticket.tier.priceInr > 0;

  return (
    <main className="min-h-screen bg-slate-50">
      <section className="container mx-auto max-w-md px-6 py-10">
        <div className="rounded-2xl border bg-white p-6 text-center shadow-sm">
          <div className="text-xs uppercase tracking-widest text-slate-500">Spectator Pass</div>
          <h1 className="mt-2 text-xl font-bold">{ticket.competition.name}</h1>
          <p className="text-sm text-slate-600">
            {new Date(ticket.competition.startDate).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}
            {ticket.competition.venue && <> · {ticket.competition.venue}</>}
          </p>

          {voided ? (
            <div className="my-6 rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
              This ticket has been voided. Contact the organiser.
            </div>
          ) : pendingPayment ? (
            <div className="my-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              Payment is still processing. The ticket activates within a minute of payment success. Refresh this page.
            </div>
          ) : checkedIn ? (
            <div className="my-6 rounded-md border border-slate-300 bg-slate-50 p-4 text-sm">
              <div className="font-semibold">Checked in</div>
              <div className="mt-1 text-xs text-slate-500">
                Scanned {new Date(ticket.checkedInAt!).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ) : (
            <div className="my-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrSrc} alt="Ticket QR" width={320} height={320} className="mx-auto" />
              <p className="mt-3 text-xs text-slate-500">Show this at the gate</p>
            </div>
          )}

          <div className="mt-4 border-t pt-4 text-left text-sm">
            <Row label="Tier" value={ticket.tier.name} />
            <Row label="Name" value={ticket.buyerName} />
            <Row label="Email" value={ticket.buyerEmail} />
            <Row label="Ticket ID" value={ticket.id.slice(-10).toUpperCase()} mono />
          </div>
        </div>

        <Link href={`/compete/${ticket.competition.slug}`} className="mt-4 block text-center text-xs text-slate-500 hover:underline">
          ← event home
        </Link>
      </section>
    </main>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between py-1.5 text-xs">
      <span className="uppercase tracking-wider text-slate-500">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}
