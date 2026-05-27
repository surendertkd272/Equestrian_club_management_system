import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { medalsForTeam } from "@/lib/medals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamsClient } from "./teams-client";
import { DeactivateButton } from "@/components/ui/deactivate-button";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const canManage = can(session.role, "competition.manage");

  const where: any = {};
  if (centreId) where.centreId = centreId;

  const [teams, riders] = await Promise.all([
    prisma.team.findMany({
      where,
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        members: {
          include: { },
        },
      },
    }),
    prisma.rider.findMany({
      where: centreId ? { centreId, status: "active" } : { status: "active" },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
  ]);

  // Resolve member rider names + roll up medals per team.
  const allMemberRiderIds = Array.from(new Set(teams.flatMap((t) => t.members.map((m) => m.riderId))));
  const memberRiders = allMemberRiderIds.length
    ? await prisma.rider.findMany({
        where: { id: { in: allMemberRiderIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const riderById = new Map(memberRiders.map((r) => [r.id, r]));

  const medalsByTeam = await Promise.all(teams.map((t) => medalsForTeam(t.id)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Teams & Squads</h1>
        <p className="text-sm text-muted-foreground">
          Named rider groups your club fields together — junior squad, senior show-jumping
          team, gymkhana side. Medal counts roll up from every member's competition entries.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Teams" value={teams.length} />
        <Kpi label="Active" value={teams.filter((t) => t.active).length} />
        <Kpi label="Riders rostered" value={allMemberRiderIds.length} />
        <Kpi
          label="Team medals (all)"
          value={medalsByTeam.reduce((s, m) => s + m.gold + m.silver + m.bronze, 0)}
        />
      </div>

      <TeamsClient canManage={canManage} riders={riders} />

      <div className="space-y-4">
        {teams.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No teams yet. Create the first one above.
          </p>
        ) : (
          teams.map((t, i) => {
            const tally = medalsByTeam[i];
            return (
              <Card key={t.id}>
                <CardHeader>
                  <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                    <span>
                      {t.name}
                      {t.season && <span className="ml-2 text-xs text-muted-foreground">{t.season}</span>}
                      {t.discipline && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          {t.discipline}
                        </Badge>
                      )}
                      {!t.active && <Badge variant="outline" className="ml-2">archived</Badge>}
                      {canManage && t.active && (
                        <DeactivateButton apiPath={`/api/teams/${t.id}`} itemName={t.name} label="Archive" />
                      )}
                    </span>
                    <span className="text-sm">
                      🥇 {tally.gold} · 🥈 {tally.silver} · 🥉 {tally.bronze}
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        ({tally.entries} entries)
                      </span>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {t.members.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No members yet.</p>
                  ) : (
                    <ul className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
                      {t.members.map((m) => {
                        const r = riderById.get(m.riderId);
                        return (
                          <li key={m.id} className="rounded border bg-muted/30 px-2 py-1">
                            <span className="font-medium">
                              {r ? `${r.firstName} ${r.lastName}` : "—"}
                            </span>
                            {m.position && (
                              <span className="ml-2 text-[10px] uppercase text-muted-foreground">
                                {m.position}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {canManage && (
                    <TeamRosterControls
                      teamId={t.id}
                      riders={riders}
                      existingRiderIds={t.members.map((m) => m.riderId)}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

import { TeamRosterControls } from "./teams-client";
