import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseClasses } from "@/lib/schemas/competition";
import { formatDate } from "@/lib/utils";
import { LiveAutoRefresh } from "./auto-refresh";
import { getDisciplineRules, rankEntries } from "@/lib/discipline";

export const dynamic = "force-dynamic";
// Auto-refresh via a client component (router.refresh, no page reload).
export const revalidate = 0;

export default async function LiveScoreboard({ params }: { params: { slug: string } }) {
  const comp = await prisma.competition.findUnique({
    where: { slug: params.slug },
    include: {
      centre: { select: { name: true, address: true } },
      entries: {
        include: { rider: { select: { firstName: true, lastName: true } } },
      },
    },
  });
  if (!comp) notFound();
  // Only show after the competition is live or completed; hide while draft.
  if (comp.status === "draft" || comp.status === "cancelled") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
        <div className="rounded-lg border bg-card p-6 text-center shadow">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{comp.centre.name}</div>
          <h1 className="mt-1 text-xl font-bold">{comp.name}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The live scoreboard goes up when the competition starts.{" "}
            {comp.status === "cancelled" ? "This event was cancelled." : "Check back later."}
          </p>
        </div>
      </main>
    );
  }

  const classes = parseClasses(comp.classesJson);
  const byClass = new Map<string, typeof comp.entries>();
  for (const cls of classes) byClass.set(cls.name, []);
  for (const e of comp.entries) {
    if (e.status === "withdrawn") continue;
    if (!byClass.has(e.className)) byClass.set(e.className, []);
    byClass.get(e.className)!.push(e);
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-secondary to-background p-4">
      {comp.status === "live" && <LiveAutoRefresh intervalMs={10_000} />}
      <div className="container max-w-3xl py-6">
        <div className="mb-6 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary">{comp.centre.name}</div>
          <h1 className="mt-1 text-3xl font-extrabold">{comp.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDate(comp.startDate)}
            {comp.startDate.getTime() !== comp.endDate.getTime() && ` — ${formatDate(comp.endDate)}`}
            {comp.venue && ` · ${comp.venue}`}
          </p>
          <div className="mt-3 inline-block rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-800">
            {comp.status === "live" ? "● live" : "Final results"}
          </div>
        </div>

        {classes.map((cls) => {
          const rules = getDisciplineRules(comp.discipline);
          const list = byClass.get(cls.name) ?? [];
          // Placed first (in order), then discipline-ranked.
          const placed = list.filter((e) => e.placement !== null).sort((a, b) => a.placement! - b.placement!);
          const live = list.filter((e) => e.placement === null);
          const sorted = [...placed, ...rankEntries(comp.discipline, live)];

          return (
            <section key={cls.name} className="mb-6 rounded-lg border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold">{cls.name}</h2>
                <span className="text-[11px] text-muted-foreground">
                  {cls.ageGroup ? `Age ${cls.ageGroup} · ` : ""}
                  {list.length} entered
                </span>
              </div>
              {sorted.length === 0 ? (
                <p className="py-2 text-center text-xs text-muted-foreground">No entries yet.</p>
              ) : (
                <ul className="space-y-1">
                  {sorted.map((e, idx) => {
                    const isPlaced = e.placement !== null;
                    const medal =
                      e.placement === 1
                        ? "🥇"
                        : e.placement === 2
                        ? "🥈"
                        : e.placement === 3
                        ? "🥉"
                        : isPlaced
                        ? `#${e.placement}`
                        : "";
                    const headline = rules.formatHeadline({
                      score: e.score,
                      faults: e.faults,
                      time: e.time,
                    });
                    return (
                      <li
                        key={e.id}
                        className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                          isPlaced ? "bg-amber-50" : "bg-muted/30"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 text-center font-mono text-sm">
                            {medal || `· ${idx + 1}`}
                          </div>
                          <div className="font-medium">
                            {e.rider.firstName} {e.rider.lastName}
                          </div>
                        </div>
                        <div className="text-sm font-mono text-muted-foreground">
                          {headline || "—"}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        <div className="mt-8 text-center text-[10px] uppercase tracking-wider text-muted-foreground">
          {comp.status === "live" ? "Live · refreshes every 10s" : "Final · Equiwings"}
        </div>
      </div>
    </main>
  );
}
