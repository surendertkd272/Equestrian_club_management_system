import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseRubric } from "@/lib/schemas/exam";
import { renderPrintable, pdfHeader, escapeHtml } from "@/lib/pdf";

// GET /api/exams/[id]/test-sheet — printable judge sheet for one exam.
// Renders the rubric with empty score boxes the examiner fills by hand;
// useful when running paper-based exams at outdoor venues without tablets.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    include: {
      rider: { select: { firstName: true, lastName: true } },
      centre: { select: { name: true } },
    },
  });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && exam.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const template = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId: exam.centreId, levelKey: String(exam.level) } },
  });
  if (!template) return NextResponse.json({ error: "NO_TEMPLATE_FOR_LEVEL" }, { status: 400 });
  // Rubric content comes from the snapshot when present so the printed
  // test sheet matches what the examiner is scoring against, even if the
  // live template has since been edited.
  const rubric = parseRubric(exam.rubricSnapshotJson ?? template.categoriesJson);

  const examDate = exam.date.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });

  let totalMax = 0;
  const sections = rubric
    .map((cat) => {
      // Flatten parent-with-subitems into individual sub-item rows so the
      // printed test sheet has one row per scoreable unit. Parent name
      // prefixes the sub-item label ("Small Jumps — Position").
      const rows = cat.items
        .flatMap((it) => {
          if (Array.isArray(it.subitems) && it.subitems.length > 0) {
            return it.subitems.map((sub) => ({
              name: `${it.name} — ${sub.name}`,
              max: sub.max_score ?? 0,
            }));
          }
          return [{ name: it.name, max: it.max_score ?? 0 }];
        })
        .map((it) => {
          totalMax += it.max;
          return `
            <tr>
              <td>${escapeHtml(it.name)}</td>
              <td style="text-align:right;width:14mm">${it.max}</td>
              <td style="width:24mm">&nbsp;</td>
            </tr>`;
        })
        .join("");
      return `
        <h3>${escapeHtml(cat.name)}</h3>
        <table>
          <thead>
            <tr>
              <th>Criterion</th>
              <th style="text-align:right">Max</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    })
    .join("");

  const body = `
    ${pdfHeader({ centreName: exam.centre.name, subtitle: `Judge sheet · Level ${exam.level} · ${template.levelName}`, date: exam.date })}
    <table style="margin-bottom:8mm">
      <tr>
        <th style="width:30%">Candidate</th>
        <td>${escapeHtml(exam.rider.firstName)} ${escapeHtml(exam.rider.lastName)}</td>
        <th style="width:20%">Date</th>
        <td>${escapeHtml(examDate)}</td>
      </tr>
      <tr>
        <th>Examiner</th>
        <td>${escapeHtml(exam.examinerName)}</td>
        <th>Time</th>
        <td>${escapeHtml(exam.time)}</td>
      </tr>
      <tr>
        <th>Pass threshold</th>
        <td>${template.passThreshold}%</td>
        <th>Max marks</th>
        <td>${totalMax}</td>
      </tr>
    </table>
    ${sections}
    <div class="totals" style="text-align:right;margin-top:6mm">
      Total: __________ / ${totalMax}
    </div>
    <div class="signature-block">
      <div>Examiner signature</div>
      <div>Candidate signature</div>
    </div>
  `;

  const html = renderPrintable({
    title: `Judge sheet · ${exam.rider.firstName} ${exam.rider.lastName} · L${exam.level}`,
    bodyHtml: body,
  });

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
