// Rider medal counts. CompetitionEntry.placement of 1/2/3 maps to
// gold/silver/bronze; anything past 3 is "placed" (top-N depending on
// the event).
//
// Lives in lib/ so both the rider analytics page and the team performance
// rollup can pull from it without duplication.

import { prisma } from "./prisma";

export type MedalTally = {
  gold: number;
  silver: number;
  bronze: number;
  placed: number;        // total placements (any placement value, including 4+)
  entries: number;        // total competition entries the rider has competed in
  byClassJson: string;    // optional rollup string for the UI legend
};

export async function medalsForRider(riderId: string): Promise<MedalTally> {
  const entries = await prisma.competitionEntry.findMany({
    where: { riderId, status: { in: ["entered"] } },
    select: { placement: true },
  });
  let gold = 0, silver = 0, bronze = 0, placed = 0;
  for (const e of entries) {
    if (e.placement === 1) { gold += 1; placed += 1; }
    else if (e.placement === 2) { silver += 1; placed += 1; }
    else if (e.placement === 3) { bronze += 1; placed += 1; }
    else if (e.placement != null) { placed += 1; }
  }
  return { gold, silver, bronze, placed, entries: entries.length, byClassJson: "" };
}

export async function medalsForTeam(teamId: string): Promise<MedalTally> {
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    select: { riderId: true },
  });
  const tallies = await Promise.all(members.map((m) => medalsForRider(m.riderId)));
  return tallies.reduce<MedalTally>(
    (acc, t) => ({
      gold: acc.gold + t.gold,
      silver: acc.silver + t.silver,
      bronze: acc.bronze + t.bronze,
      placed: acc.placed + t.placed,
      entries: acc.entries + t.entries,
      byClassJson: "",
    }),
    { gold: 0, silver: 0, bronze: 0, placed: 0, entries: 0, byClassJson: "" },
  );
}
