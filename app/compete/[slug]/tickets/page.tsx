import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TicketsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function TicketsPage({ params }: { params: { slug: string } }) {
  const comp = await prisma.competition.findUnique({
    where: { slug: params.slug },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      ticketTiers: { where: { active: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!comp) notFound();
  if (comp.ticketTiers.length === 0) {
    return (
      <main className="min-h-screen bg-muted/40">
        <section className="container mx-auto max-w-2xl px-6 py-16 text-center">
          <h1 className="text-2xl font-bold">Tickets not available yet</h1>
          <p className="mt-3 text-muted-foreground">The organiser hasn't published ticket tiers for this event.</p>
          <Link href={`/compete/${comp.slug}`} className="mt-6 inline-block text-primary underline">Back to event</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/40">
      <header className="border-b bg-card">
        <div className="container mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href={`/compete/${comp.slug}`} className="text-sm text-muted-foreground hover:text-primary">← Back</Link>
        </div>
      </header>
      <section className="container mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">Tickets · {comp.name}</h1>
        <p className="mt-2 text-muted-foreground">Buy spectator tickets. Each ticket has its own QR — scan at the gate.</p>
        <TicketsForm
          slug={comp.slug}
          tiers={comp.ticketTiers.map((t) => ({ id: t.id, name: t.name, priceInr: t.priceInr, description: t.description }))}
        />
      </section>
    </main>
  );
}
