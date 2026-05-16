import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseClasses } from "@/lib/schemas/competition";
import { JudgeBoard } from "./board";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// Streamlined ringside view: pick a class + (optional) round, see entries
// ordered as start-list, tap to enter scores. No sponsor/prize panels, no
// status controls — just the data a judge needs at the ring.
export default async function JudgePage({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  if (!can(session.role, "competition.manage")) redirect("/competitions");

  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    include: {
      entries: {
        include: {
          rider: { select: { firstName: true, lastName: true } },
          team: { select: { name: true } },
        },
      },
      startList: { orderBy: [{ className: "asc" }, { order: "asc" }] },
      rounds: { orderBy: [{ className: "asc" }, { roundNumber: "asc" }] },
    },
  });
  if (!comp) notFound();
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) notFound();

  const classes = parseClasses(comp.classesJson);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2">
          <Link href={`/competitions/${comp.id}`} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100">
            <ChevronLeft className="h-3.5 w-3.5" /> Back to manage
          </Link>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Ringside</div>
            <div className="text-sm font-semibold">{comp.name}</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-4">
        <JudgeBoard
          competitionId={comp.id}
          discipline={comp.discipline}
          classes={classes.map((c) => c.name)}
          rounds={comp.rounds.map((r) => ({ id: r.id, className: r.className, roundNumber: r.roundNumber, name: r.name }))}
          startList={comp.startList.map((s) => ({
            entryId: s.entryId,
            className: s.className,
            order: s.order,
          }))}
          entries={comp.entries.map((e) => ({
            id: e.id,
            riderName: `${e.rider.firstName} ${e.rider.lastName}`,
            className: e.className,
            score: e.score,
            faults: e.faults,
            time: e.time,
            placement: e.placement,
            team: e.team?.name ?? null,
            status: e.status,
          }))}
        />
      </main>
    </div>
  );
}
