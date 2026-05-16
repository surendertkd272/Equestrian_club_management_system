import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseClasses } from "@/lib/schemas/competition";
import { renderPrintable, pdfHeader, escapeHtml } from "@/lib/pdf";

// Printable program — pre-event handout. Per class: header, fee, age group,
// and the start list (if a draw has been run) or just the entry roster.
// Tenant-scoped: only managers/competition staff inside the competition's
// centre can pull this.
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
        },
        where: { status: { not: "withdrawn" } },
      },
      startList: {
        orderBy: [{ className: "asc" }, { order: "asc" }],
        include: {
          entry: {
            include: {
              rider: { select: { firstName: true, lastName: true } },
              team: { select: { name: true } },
            },
          },
        },
      },
      rounds: { orderBy: [{ className: "asc" }, { roundNumber: "asc" }] },
    },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const classes = parseClasses(comp.classesJson);
  const startByClass = new Map<string, typeof comp.startList>();
  for (const sl of comp.startList) {
    if (!startByClass.has(sl.className)) startByClass.set(sl.className, []);
    startByClass.get(sl.className)!.push(sl);
  }
  const entriesByClass = new Map<string, typeof comp.entries>();
  for (const e of comp.entries) {
    if (!entriesByClass.has(e.className)) entriesByClass.set(e.className, []);
    entriesByClass.get(e.className)!.push(e);
  }

  const sections = classes
    .map((cls) => {
      const starts = startByClass.get(cls.name) ?? [];
      const rounds = comp.rounds.filter((r) => r.className === cls.name);
      const rows = (
        starts.length > 0
          ? starts.map(
              (s, i) =>
                `<tr><td style="width:14mm;text-align:right">#${s.order}</td><td>${escapeHtml(s.entry.rider.firstName)} ${escapeHtml(s.entry.rider.lastName)}</td><td>${escapeHtml(s.entry.team?.name ?? "")}</td></tr>`,
            )
          : (entriesByClass.get(cls.name) ?? []).map(
              (e, i) =>
                `<tr><td style="width:14mm;text-align:right">${i + 1}</td><td>${escapeHtml(e.rider.firstName)} ${escapeHtml(e.rider.lastName)}</td><td></td></tr>`,
            )
      ).join("");
      return `
        <h3>${escapeHtml(cls.name)}${cls.ageGroup ? ` · age ${escapeHtml(cls.ageGroup)}` : ""}${cls.fee ? ` · ₹${cls.fee} entry` : ""}</h3>
        ${rounds.length > 0 ? `<div style="font-size:10pt;color:#444;margin-bottom:2mm">Rounds: ${rounds.map((r) => escapeHtml(r.name)).join(", ")}</div>` : ""}
        <table>
          <thead>
            <tr><th style="text-align:right;width:14mm">#</th><th>Rider</th><th>Team</th></tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="3" style="text-align:center;color:#888">No entries yet</td></tr>`}</tbody>
        </table>
      `;
    })
    .join("");

  const body = `
    ${pdfHeader({ centreName: comp.centre.name, subtitle: `Program · ${comp.name}`, date: comp.startDate })}
    <div style="margin-bottom:4mm;font-size:10pt;color:#444">
      ${comp.venue ? `<div>Venue: <b>${escapeHtml(comp.venue)}</b></div>` : ""}
      <div>Scope: ${escapeHtml(comp.scope.replaceAll("_", " "))} · Discipline: ${escapeHtml(comp.discipline)}</div>
    </div>
    ${sections}
  `;
  const html = renderPrintable({ title: `Program · ${comp.name}`, bodyHtml: body });
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
