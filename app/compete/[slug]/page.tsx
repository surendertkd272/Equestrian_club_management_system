import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

// Public competition page — same content for every visitor. Cache for
// 60s so repeated visits (people sharing the link) skip the DB query.
// Class changes propagate within a minute, which is fine for a marketing
// surface. NO force-dynamic — that would defeat the cache.
export const revalidate = 60;

// Public competition page. No auth required. Visitors see:
//   • Show details, classes, fees, deadline
//   • An entry button → /compete/[slug]/enter (form + magic-link verify)
//   • A tickets button → /compete/[slug]/tickets (if ticket tiers exist)
//
// This is the marketing surface for open shows — federation-sanctioned
// events typically advertise this URL on their poster.
export default async function PublicCompetitionPage({ params }: { params: { slug: string } }) {
  const comp = await prisma.competition.findUnique({
    where: { slug: params.slug },
    include: {
      centre: { select: { name: true, address: true, org: { select: { name: true } } } },
      sponsors: { select: { name: true, tier: true } },
      ticketTiers: { where: { active: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!comp || comp.status === "draft" || comp.status === "cancelled") notFound();

  // classesJson is a jsonb column — already parsed by Prisma.
  const classes: Array<{ name: string; fee?: number; ageGroup?: string; maxEntries?: number }> =
    Array.isArray(comp.classesJson)
      ? (comp.classesJson as Array<{ name: string; fee?: number; ageGroup?: string; maxEntries?: number }>)
      : [];

  const entriesOpen = comp.status === "open_for_entries" && (!comp.entryDeadline || comp.entryDeadline > new Date());

  return (
    <main className="min-h-screen bg-muted/40">
      <header className="border-b bg-card">
        <div className="container mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-sm font-bold">Equiwings</Link>
          <nav className="text-sm text-muted-foreground">
            <Link href={`/scoreboard/${comp.slug}`} className="hover:text-primary">Live results →</Link>
          </nav>
        </div>
      </header>

      <section className="container mx-auto max-w-4xl px-6 py-12">
        <div className="inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
          {comp.scope.replace("_", " ").toUpperCase()} · {comp.discipline.toUpperCase()}
        </div>
        <h1 className="mt-3 text-4xl font-bold">{comp.name}</h1>
        <p className="mt-2 text-muted-foreground">
          {comp.centre.name} · {comp.centre.org.name}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {new Date(comp.startDate).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}
          {comp.startDate.toDateString() !== comp.endDate.toDateString() && (
            <> → {new Date(comp.endDate).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</>
          )}
          {comp.venue && <> · {comp.venue}</>}
        </p>
        {comp.centre.address && <p className="mt-1 text-xs text-muted-foreground">{comp.centre.address}</p>}

        <div className="mt-8 flex flex-wrap gap-3">
          {entriesOpen && (
            <Link
              href={`/compete/${comp.slug}/enter`}
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Enter the competition
            </Link>
          )}
          {comp.ticketTiers.length > 0 && (
            <Link
              href={`/compete/${comp.slug}/tickets`}
              className="rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium hover:bg-muted"
            >
              Buy spectator tickets
            </Link>
          )}
          <Link
            href={`/scoreboard/${comp.slug}`}
            className="rounded-md border border-border bg-card px-5 py-2.5 text-sm font-medium hover:bg-muted"
          >
            Live results
          </Link>
        </div>

        {comp.entryDeadline && (
          <p className="mt-3 text-xs text-muted-foreground">
            Entry deadline: {new Date(comp.entryDeadline).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        )}

        <section className="mt-12">
          <h2 className="text-xl font-bold">Classes</h2>
          {classes.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No classes published yet.</p>
          ) : (
            <ul className="mt-4 divide-y rounded-lg border bg-card">
              {classes.map((c) => (
                <li key={c.name} className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    {c.ageGroup && <div className="text-xs text-muted-foreground">{c.ageGroup}</div>}
                  </div>
                  <div className="text-right text-sm">
                    {c.fee !== undefined && (
                      <div className="font-semibold">₹{c.fee.toLocaleString("en-IN")}</div>
                    )}
                    {c.maxEntries && (
                      <div className="text-xs text-muted-foreground">Cap {c.maxEntries}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {comp.sponsors.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-bold">Sponsors</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              {comp.sponsors.map((s, i) => (
                <span key={i} className="rounded-full border bg-card px-3 py-1.5 text-sm">
                  {s.name}
                  {s.tier && <span className="ml-2 text-xs text-muted-foreground">{s.tier}</span>}
                </span>
              ))}
            </div>
          </section>
        )}
      </section>

      <footer className="border-t bg-card py-6 text-center text-xs text-muted-foreground">
        Powered by Equiwings
      </footer>
    </main>
  );
}
