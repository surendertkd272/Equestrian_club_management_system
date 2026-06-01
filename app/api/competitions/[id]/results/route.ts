import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseClasses } from "@/lib/schemas/competition";
import { renderPrintable, pdfHeader, escapeHtml } from "@/lib/pdf";
import { disciplineLabel } from "@/lib/competition-disciplines";
import { getDisciplineRules, getDisciplineRulesForClass, rankEntries, scoringEngineFor } from "@/lib/discipline";

// Printable post-event results sheet. Shows placements, headline scores
// (discipline-formatted), sponsors-per-prize, and team standings.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    include: {
      centre: { select: { name: true } },
      entries: {
        include: {
          rider: { select: { firstName: true, lastName: true } },
          team: { select: { name: true } },
        },
      },
      prizes: true,
      sponsors: true,
    },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const classes = parseClasses(comp.classesJson);
  // Competition-wide scoring type — used as the fallback + in the header line.
  const fallbackRules = getDisciplineRules(comp.discipline);

  const byClass = new Map<string, typeof comp.entries>();
  for (const e of comp.entries) {
    if (e.status === "withdrawn") continue;
    if (!byClass.has(e.className)) byClass.set(e.className, []);
    byClass.get(e.className)!.push(e);
  }

  const sections = classes
    .map((cls) => {
      // Each event scores by its own discipline; comp.discipline is fallback.
      const engine = scoringEngineFor(cls.discipline, comp.discipline);
      const rules = getDisciplineRulesForClass(cls.discipline, comp.discipline);
      const list = byClass.get(cls.name) ?? [];
      const placed = list.filter((e) => e.placement !== null).sort((a, b) => a.placement! - b.placement!);
      const live = list.filter((e) => e.placement === null);
      const sorted = [...placed, ...rankEntries(engine, live)];
      const classPrizes = comp.prizes.filter((p) => p.className === cls.name);

      const rows = sorted
        .map((e, idx) => {
          const place = e.placement ?? idx + 1;
          const prize = classPrizes.find((p) => p.placement === e.placement);
          const sponsor = prize?.sponsoredById
            ? comp.sponsors.find((s) => s.id === prize.sponsoredById)?.name
            : null;
          const headline = rules.formatHeadline({
            score: e.score,
            faults: e.faults,
            time: e.time,
          });
          return `
            <tr>
              <td style="width:12mm;text-align:right">${place}</td>
              <td>${escapeHtml(e.rider.firstName)} ${escapeHtml(e.rider.lastName)}</td>
              <td>${escapeHtml(e.team?.name ?? "")}</td>
              <td style="text-align:right">${escapeHtml(headline || "—")}</td>
              <td>${escapeHtml(prize?.title ?? "")}${sponsor ? ` <span style="color:#666">— ${escapeHtml(sponsor)}</span>` : ""}</td>
            </tr>`;
        })
        .join("");
      return `
        <h3>${escapeHtml(cls.name)}${cls.discipline ? ` · ${escapeHtml(disciplineLabel(cls.discipline))}` : ""}${cls.ageGroup ? ` · age ${escapeHtml(cls.ageGroup)}` : ""}</h3>
        <table>
          <thead>
            <tr><th style="text-align:right;width:12mm">#</th><th>Rider</th><th>Team</th><th style="text-align:right">${escapeHtml(rules.primaryColumn)}</th><th>Prize</th></tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="5" style="text-align:center;color:#888">No results</td></tr>`}</tbody>
        </table>
      `;
    })
    .join("");

  const body = `
    ${pdfHeader({ centreName: comp.centre.name, subtitle: `Results · ${comp.name}`, date: comp.startDate })}
    <div style="margin-bottom:4mm;font-size:10pt;color:#444">
      Scoring type: <b>${fallbackRules.label}</b> · Scope: ${escapeHtml(comp.scope.replaceAll("_", " "))}
    </div>
    ${sections}
    <div class="signature-block" style="margin-top:10mm">
      <div>Chief judge</div>
      <div>Show director</div>
    </div>
  `;
  const html = renderPrintable({ title: `Results · ${comp.name}`, bodyHtml: body });
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
