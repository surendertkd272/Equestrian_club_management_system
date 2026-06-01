// Tiny HTML renderer for an exam result breakdown, used inside the
// parent email on exam submit. Walks the rubric (snapshot preferred) and
// emits one row per leaf item / sub-item with the rider's score on the
// right. Mirrors the read-only RubricView in components/exams but
// inlines the styles since email clients ignore stylesheets.

import { parseRubric, type RubricCategory } from "@/lib/schemas/exam";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sumCategory(
  cat: RubricCategory,
  scores: Record<string, number | string>,
): { score: number; max: number } {
  let score = 0;
  let max = 0;
  for (const item of cat.items) {
    if (Array.isArray(item.subitems) && item.subitems.length > 0) {
      for (const sub of item.subitems) {
        max += sub.max_score ?? 0;
        const v = scores[`${cat.name}_${item.name}_${sub.name}`];
        if (typeof v === "number") score += v;
      }
    } else {
      max += item.max_score ?? 0;
      const v = scores[`${cat.name}_${item.name}`];
      if (typeof v === "number") score += v;
    }
  }
  return { score, max };
}

function fmt(v: number | string | undefined, max: number): string {
  if (v === undefined) return "—";
  if (typeof v === "number") return `${v}/${max}`;
  return String(v);
}

// Render the category breakdown as inline-styled HTML for email bodies.
// Pass either the rubric snapshot or the live template's categoriesJson.
export function renderExamBreakdownHtml(
  rubricJson: unknown,
  scores: Record<string, number | string>,
): string {
  const cats = parseRubric(rubricJson);
  if (cats.length === 0) return "";
  const sections = cats
    .map((cat) => {
      const { score, max } = sumCategory(cat, scores);
      const rows = cat.items
        .flatMap((item) => {
          if (Array.isArray(item.subitems) && item.subitems.length > 0) {
            return [
              { name: item.name, isParent: true, score: "", max: "" },
              ...item.subitems.map((sub) => ({
                name: `    ${sub.name}`,
                isParent: false,
                score: String(fmt(scores[`${cat.name}_${item.name}_${sub.name}`], sub.max_score ?? 0)),
                max: "",
              })),
            ];
          }
          return [
            {
              name: item.name,
              isParent: false,
              score: String(fmt(scores[`${cat.name}_${item.name}`], item.max_score ?? 0)),
              max: "",
            },
          ];
        })
        .map(
          (r) =>
            `<tr><td style="padding:4px 8px;${r.isParent ? "font-weight:600;color:#374151;" : "color:#6b7280;"}">${escapeHtml(r.name)}</td><td style="padding:4px 8px;text-align:right;font-family:monospace;font-size:12px;color:#374151;">${escapeHtml(r.score)}</td></tr>`,
        )
        .join("");
      return `
        <div style="margin:12px 0;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 8px;background:#f3f4f6;border-radius:4px 4px 0 0;border:1px solid #e5e7eb;border-bottom:none;">
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#374151;">${escapeHtml(cat.name)}</span>
            <span style="font-family:monospace;font-size:11px;color:#6b7280;">${score}/${max}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:0 0 4px 4px;">${rows}</table>
        </div>`;
    })
    .join("");
  return `<div style="margin:20px 0;"><h3 style="margin:16px 0 8px;font-size:13px;color:#374151;">Score breakdown</h3>${sections}</div>`;
}
