import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { parseClasses } from "@/lib/schemas/competition";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ClassPanel } from "./class-panel";
import { StatusControl } from "./status-control";
import { OpsPanel } from "./ops-panel";
import { TeamsPanel } from "./teams-panel";
import { RoundsPanel } from "./rounds-panel";
import { OfficialsPanel } from "./officials-panel";
import { ShowDayPanel } from "./show-day-panel";
import { ExternalEntriesPanel } from "./external-entries-panel";
import { TicketingPanel } from "./ticketing-panel";
import { getDisciplineRules } from "@/lib/discipline";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  draft: "outline",
  open_for_entries: "warning",
  live: "success",
  completed: "outline",
  cancelled: "destructive",
};

export default async function CompetitionDetail({ params }: { params: { id: string } }) {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    include: {
      entries: {
        include: {
          rider: { select: { id: true, firstName: true, lastName: true } },
          team: { select: { id: true, name: true } },
        },
      },
      sponsors: true,
      prizes: true,
      rounds: { orderBy: { roundNumber: "asc" } },
    },
  });
  if (!comp) notFound();
  if (centreId && comp.centreId !== centreId) notFound();

  const classes = parseClasses(comp.classesJson);
  const canManage = can(session.role, "competition.manage");

  // Riders + horses available for entry + staff for officials assignment.
  const [riders, horses, teams, officialsStaff] = await Promise.all([
    prisma.rider.findMany({
      where: { centreId: comp.centreId, status: "active" },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.horse.findMany({
      where: { centreId: comp.centreId, status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.team.findMany({
      where: { centreId: comp.centreId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { centreId: comp.centreId, status: "active", role: { notIn: ["RIDER", "PARENT"] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const discipline = comp.discipline;
  const disciplineRules = getDisciplineRules(discipline);

  // Group entries by class
  const entriesByClass = new Map<string, typeof comp.entries>();
  for (const cls of classes) entriesByClass.set(cls.name, []);
  for (const e of comp.entries) {
    if (!entriesByClass.has(e.className)) entriesByClass.set(e.className, []);
    entriesByClass.get(e.className)!.push(e);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/competitions">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          {(comp.status === "live" || comp.status === "completed") && (
            <Button asChild variant="outline" size="sm">
              <a href={`/scoreboard/${comp.slug}`} target="_blank">
                Public scoreboard <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          <Badge variant={STATUS_VARIANT[comp.status] ?? "outline"}>{comp.status.replaceAll("_", " ")}</Badge>
          {canManage && <StatusControl id={comp.id} currentStatus={comp.status} />}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{comp.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-2 text-sm md:grid-cols-4">
            <dt className="text-muted-foreground">Dates</dt>
            <dd className="md:col-span-1">
              {formatDate(comp.startDate)}
              {comp.startDate.getTime() !== comp.endDate.getTime() && ` — ${formatDate(comp.endDate)}`}
            </dd>
            <dt className="text-muted-foreground">Venue</dt>
            <dd>{comp.venue ?? "—"}</dd>
            <dt className="text-muted-foreground">Scope</dt>
            <dd>{comp.scope.replaceAll("_", " ")}</dd>
            <dt className="text-muted-foreground">Scoring type</dt>
            <dd>{disciplineRules.label}</dd>
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-mono text-xs">{comp.slug}</dd>
            <dt className="text-muted-foreground">Entry deadline</dt>
            <dd>{comp.entryDeadline ? formatDate(comp.entryDeadline) : "—"}</dd>
            <dt className="text-muted-foreground">Classes</dt>
            <dd>{classes.length}</dd>
            <dt className="text-muted-foreground">Total entries</dt>
            <dd>{comp.entries.length}</dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2 border-t pt-3 text-xs">
            <a
              href={`/api/competitions/${comp.id}/program`}
              target="_blank"
              rel="noopener"
              className="rounded-md border bg-card px-2 py-1 hover:bg-muted"
            >
              📄 Print program
            </a>
            {comp.status === "completed" && (
              <a
                href={`/api/competitions/${comp.id}/results`}
                target="_blank"
                rel="noopener"
                className="rounded-md border bg-card px-2 py-1 hover:bg-muted"
              >
                🏆 Print results
              </a>
            )}
            {(comp.status === "live" || comp.status === "open_for_entries") && canManage && (
              <a
                href={`/competitions/${comp.id}/judge`}
                target="_blank"
                rel="noopener"
                className="rounded-md border bg-emerald-50 px-2 py-1 text-emerald-800 hover:bg-emerald-100"
              >
                Ringside judges&apos; view →
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      {classes.map((cls) => {
        const entries = entriesByClass.get(cls.name) ?? [];
        return (
          <ClassPanel
            key={cls.name}
            competitionId={comp.id}
            competitionStatus={comp.status}
            discipline={discipline}
            cls={cls}
            entries={entries.map((e) => ({
              id: e.id,
              riderId: e.riderId,
              riderName: `${e.rider.firstName} ${e.rider.lastName}`,
              status: e.status,
              paid: e.paid,
              placement: e.placement,
              score: e.score,
              faults: e.faults,
              time: e.time,
              teamId: e.teamId,
              teamName: e.team?.name ?? null,
              notes: e.notes,
              horseId: e.horseId,
            }))}
            riders={riders.map((r) => ({ id: r.id, label: `${r.firstName} ${r.lastName}` }))}
            horses={horses.map((h) => ({ id: h.id, label: h.name }))}
            teams={teams}
            canManage={canManage}
          />
        );
      })}

      <RoundsPanel
        competitionId={comp.id}
        canManage={canManage}
        classNames={classes.map((c) => c.name)}
        discipline={discipline}
        rounds={comp.rounds.map((r) => ({
          id: r.id,
          className: r.className,
          roundNumber: r.roundNumber,
          name: r.name,
          phase: r.phase,
        }))}
      />

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Officials</h3>
          <p className="text-xs text-muted-foreground">Ground jury, TD, judges, course designer, stewards, vets.</p>
        </div>
        <div className="p-4">
          <OfficialsPanel competitionId={comp.id} canManage={canManage} staff={officialsStaff} />
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">External entries</h3>
          <p className="text-xs text-muted-foreground">
            Visiting riders submitted via the public page. Approve to add to the start list.
          </p>
        </div>
        <div className="p-4">
          <ExternalEntriesPanel competitionId={comp.id} canManage={canManage} />
        </div>
      </div>

      <ShowDayPanel competitionId={comp.id} canManage={canManage} />

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Ticketing</h3>
          <p className="text-xs text-muted-foreground">Spectator tiers + QR check-in at the gate.</p>
        </div>
        <div className="p-4">
          <TicketingPanel competitionId={comp.id} canManage={canManage} />
        </div>
      </div>

      <TeamsPanel
        competitionId={comp.id}
        canManage={canManage}
        discipline={discipline}
        teams={teams}
        entries={comp.entries.map((e) => ({
          id: e.id,
          riderName: `${e.rider.firstName} ${e.rider.lastName}`,
          className: e.className,
          teamId: e.teamId,
          score: e.score,
          faults: e.faults,
          time: e.time,
        }))}
      />

      <OpsPanel
        competitionId={comp.id}
        classNames={classes.map((c) => c.name)}
        drawCompleted={comp.drawCompleted}
        initialSponsors={comp.sponsors.map((s) => ({ id: s.id, name: s.name, tier: s.tier }))}
        initialPrizes={comp.prizes.map((p) => ({
          id: p.id,
          className: p.className,
          placement: p.placement,
          title: p.title,
          cashAmount: p.cashAmount,
          trophyLabel: p.trophyLabel,
          sponsoredById: p.sponsoredById,
        }))}
        canManage={canManage}
      />
    </div>
  );
}
