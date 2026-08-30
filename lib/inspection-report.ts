import { prisma } from "@/lib/prisma";
import { notifyHq } from "@/lib/notify";
import { sendEmail, renderEmail, isValidEmail } from "@/lib/email";

// Reporting a completed inspection upward.
//
// Completing a run used to stamp completedAt and stop. The entire point of a
// centre manager inspecting stock is that somebody above them hears the
// result — "it's in the system if you go looking" is the same failure shape as
// the nightly batch that sat dead for two months because nothing announced it.
//
// The headline is the DISCREPANCY, not the tick count. "18 items checked" is
// noise; "3 items short by 7 pairs of tendon boots" is the reason anyone reads
// this at all.

export type InspectionSummary = {
  total: number;
  passed: number;
  failed: number;
  na: number;
  pending: number;
  /** Inventory lines where the count on the floor differed from the register. */
  discrepancies: { label: string; expected: number; counted: number; delta: number }[];
  netDelta: number;
};

export function summariseRun(
  items: {
    label: string;
    result: string;
    expected: number | null;
    counted: number | null;
  }[],
): InspectionSummary {
  const discrepancies = items
    .filter((i) => i.expected != null && i.counted != null && i.counted !== i.expected)
    .map((i) => ({
      label: i.label,
      expected: i.expected!,
      counted: i.counted!,
      delta: i.counted! - i.expected!,
    }))
    // Biggest shortfalls first — a missing saddle matters more than a spare
    // hoof pick, and whoever reads this reads the top of the list.
    .sort((a, b) => a.delta - b.delta);

  return {
    total: items.length,
    passed: items.filter((i) => i.result === "pass").length,
    failed: items.filter((i) => i.result === "fail").length,
    na: items.filter((i) => i.result === "na").length,
    pending: items.filter((i) => i.result === "pending").length,
    discrepancies,
    netDelta: discrepancies.reduce((sum, d) => sum + d.delta, 0),
  };
}

function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Notify the org's HQ tier that an inspection finished, and what it found. */
export async function notifyHqOfInspection(runId: string, centreId: string, byUserId: string) {
  const run = await prisma.auditRun.findUnique({
    where: { id: runId },
    include: {
      items: { select: { label: true, result: true, expected: true, counted: true, remarks: true } },
      centre: { select: { name: true, orgId: true } },
      inspector: { select: { name: true, role: true } },
    },
  });
  if (!run) return;

  const s = summariseRun(run.items);
  const centreName = run.centre.name;
  const who = run.inspector?.name ?? "A staff member";
  const scopeLabel = run.scope.replace(/_/g, " ");

  // Lead with what is wrong. A clean run is one line; a run with findings puts
  // them in the title so it reads correctly in a notification list.
  const headline =
    s.failed > 0 || s.discrepancies.length > 0
      ? `${centreName}: ${scopeLabel} inspection found ${
          s.discrepancies.length > 0
            ? `${s.discrepancies.length} stock discrepanc${s.discrepancies.length === 1 ? "y" : "ies"}`
            : `${s.failed} failed check${s.failed === 1 ? "" : "s"}`
        }`
      : `${centreName}: ${scopeLabel} inspection clean`;

  await notifyHq(run.centre.orgId, {
    centreId,
    type: "inspection_completed",
    title: headline,
    body:
      s.discrepancies.length > 0
        ? `${who} counted ${s.total} lines. Net ${s.netDelta > 0 ? "+" : ""}${s.netDelta} against the register.`
        : `${who} completed ${s.total} checks · ${s.passed} pass · ${s.failed} fail.`,
    link: `/inspections/${run.id}`,
    // Findings are worth interrupting for; a clean run should not override
    // somebody's notification preferences.
    ...(s.failed > 0 || s.discrepancies.length > 0
      ? { criticality: "critical" as const }
      : {}),
  });

  // Email as well when there is something to act on. An in-app notification is
  // enough for a clean run; a shortfall of stock is worth an inbox.
  if (s.discrepancies.length === 0 && s.failed === 0) return;

  const recipients = await prisma.user.findMany({
    where: {
      role: { in: ["SUPER_ADMIN", "ADMIN"] },
      status: "active",
      OR: [{ orgId: run.centre.orgId }, { centre: { orgId: run.centre.orgId } }],
    },
    select: { email: true },
  });

  const rows = s.discrepancies
    .slice(0, 25)
    .map(
      (d) =>
        `<tr><td>${esc(d.label)}</td><td align="right">${d.expected}</td><td align="right">${
          d.counted
        }</td><td align="right"><strong>${d.delta > 0 ? "+" : ""}${d.delta}</strong></td></tr>`,
    )
    .join("");

  const failedChecks = run.items
    .filter((i) => i.result === "fail")
    .slice(0, 25)
    .map((i) => `<li>${esc(i.label)}${i.remarks ? ` — ${esc(i.remarks)}` : ""}</li>`)
    .join("");

  for (const r of recipients) {
    if (!isValidEmail(r.email)) continue;
    await sendEmail({
      to: r.email,
      subject: headline,
      html: renderEmail({
        heading: headline,
        centreName,
        body: `<p>${esc(who)} completed a ${esc(scopeLabel)} inspection at <strong>${esc(
          centreName,
        )}</strong>.</p>
${
  s.discrepancies.length > 0
    ? `<p><strong>Stock counted against the register:</strong></p>
<table cellpadding="4" style="border-collapse:collapse;font-size:14px">
  <tr><th align="left">Item</th><th align="right">Register</th><th align="right">Counted</th><th align="right">Diff</th></tr>
  ${rows}
</table>
${s.discrepancies.length > 25 ? `<p>…and ${s.discrepancies.length - 25} more.</p>` : ""}`
    : ""
}
${failedChecks ? `<p><strong>Failed checks:</strong></p><ul>${failedChecks}</ul>` : ""}
${run.summary ? `<p><strong>Inspector's note:</strong> ${esc(run.summary)}</p>` : ""}`,
        ctaText: "Open the inspection",
        ctaUrl: `/inspections/${run.id}`,
      }),
    });
  }
}
