import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseRubric } from "@/lib/schemas/exam";
import { renderPrintable, pdfHeader, escapeHtml } from "@/lib/pdf";

// GET /api/exams/[id]/result-sheet — rider-facing result card. Unlike the
// judge sheet (paper input form), this renders the FINAL scores with
// section breakdown, deductions, time faults, pass/fail verdict and
// signature lines. Issued only after the exam is completed.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    include: {
      rider: { select: { firstName: true, lastName: true, dob: true } },
      centre: { select: { name: true } },
      judges: { orderBy: { position: "asc" } },
    },
  });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && exam.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (exam.status !== "completed") {
    return NextResponse.json({ error: "NOT_COMPLETED" }, { status: 409 });
  }

  const template = await prisma.scoringTemplate.findUnique({
    where: { centreId_levelKey: { centreId: exam.centreId, levelKey: String(exam.level) } },
  });
  if (!template) return NextResponse.json({ error: "NO_TEMPLATE_FOR_LEVEL" }, { status: 400 });
  const rubric = parseRubric(template.categoriesJson);

  // Use the legacy lead scoresJson if present; otherwise pull the lead
  // judge's row. Co-judge cards aren't shown individually on the rider
  // result — only the aggregate.
  // scoresJson is a jsonb column — Prisma returns the parsed object directly.
  // Narrow defensively in case a legacy row holds a primitive/array.
  const scores: Record<string, number | string> =
    exam.scoresJson && typeof exam.scoresJson === "object" && !Array.isArray(exam.scoresJson)
      ? (exam.scoresJson as Record<string, number | string>)
      : {};

  let totalMax = 0;
  const sections = rubric
    .map((cat) => {
      const rows = cat.items
        .map((it) => {
          const isNum = !it.type || it.type === "numeric";
          if (isNum) totalMax += it.max_score;
          const key = `${cat.name}_${it.name}`;
          const raw = scores[key];
          const display =
            raw === undefined ? "—" : typeof raw === "number" ? String(raw) : escapeHtml(String(raw));
          return `
            <tr>
              <td>${escapeHtml(it.name)}</td>
              <td style="text-align:right;width:14mm">${isNum ? it.max_score : "—"}</td>
              <td style="width:24mm;text-align:right">${display}</td>
            </tr>`;
        })
        .join("");
      return `
        <h3>${escapeHtml(cat.name)}</h3>
        <table>
          <thead>
            <tr><th>Criterion</th><th style="text-align:right">Max</th><th style="text-align:right">Score</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    })
    .join("");

  const verdict = exam.passed ? "PASS" : "DID NOT PASS";
  const verdictColor = exam.passed ? "#047857" : "#b91c1c";
  const finalScore = exam.totalScore ?? 0;
  const examDate = exam.date.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
  const judgeBlock = [
    `<div>Lead examiner: <b>${escapeHtml(exam.examinerName)}</b></div>`,
    ...exam.judges
      .filter((j) => j.judgeId !== exam.examinerId)
      .map((j) => `<div>Co-judge: <b>${escapeHtml(j.judgeName)}</b> · ${j.subTotal ?? "—"}</div>`),
  ].join("");

  const body = `
    ${pdfHeader({ centreName: exam.centre.name, subtitle: `Exam result · Level ${exam.level} · ${template.levelName}`, date: exam.date })}
    <table style="margin-bottom:6mm">
      <tr>
        <th style="width:30%">Candidate</th>
        <td>${escapeHtml(exam.rider.firstName)} ${escapeHtml(exam.rider.lastName)}</td>
        <th style="width:20%">Date</th>
        <td>${escapeHtml(examDate)}</td>
      </tr>
      <tr>
        <th>Attempt</th>
        <td>${exam.attemptNumber}</td>
        <th>Pass threshold</th>
        <td>${template.passThreshold}%</td>
      </tr>
    </table>
    ${sections}
    <div style="margin-top:6mm;border-top:2px solid #111;padding-top:4mm;display:grid;grid-template-columns:1fr 1fr;gap:6mm">
      <div>
        ${judgeBlock}
      </div>
      <div style="text-align:right">
        <div>Rubric subtotal: <b>${finalScore + exam.deductions + exam.timeFaults}</b></div>
        ${exam.deductions ? `<div>Deductions: <b>−${exam.deductions}</b></div>` : ""}
        ${exam.timeFaults ? `<div>Time faults: <b>−${exam.timeFaults}</b></div>` : ""}
        <div style="margin-top:2mm;font-size:14pt">Final: <b>${finalScore} / ${totalMax}</b></div>
        <div style="margin-top:3mm;font-size:18pt;font-weight:800;color:${verdictColor}">${verdict}</div>
      </div>
    </div>
    <div class="signature-block" style="margin-top:10mm">
      <div>Examiner signature</div>
      <div>Centre stamp</div>
    </div>
  `;

  const html = renderPrintable({
    title: `Result · ${exam.rider.firstName} ${exam.rider.lastName} · L${exam.level}`,
    bodyHtml: body,
  });
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
