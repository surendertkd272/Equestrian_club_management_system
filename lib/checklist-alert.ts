import { prisma } from "@/lib/prisma";
import { notifyMany } from "@/lib/notify";
import { getNotifPrefs, allowsChannel } from "@/lib/notify-prefs";
import { sendEmail, renderEmail, isValidEmail } from "@/lib/email";
import { absoluteUrl, hasBaseUrl } from "@/lib/absolute-url";

// "A coach ticked 'not done' on cleaning the hooves — how do I find out?"
//
// Before this, nobody did. A failed check was stored and counted on the
// checklist page, and the only way to learn of it was to open that page and
// notice an amber number. Now a submission with any item marked not done tells
// the people who can act on it, with the items named, and links to the full
// report.
//
// Who hears: the centre's manager (Centre.managerId and any CENTRE_MANAGER),
// stable managers and head coaches at that centre, and the organisation's HQ.
// Never the person who filed it. In-app for all of them (respecting their
// in-app preference, which notify() applies); email as well unless they have
// switched email off in their notification settings.

const CENTRE_ROLES = ["CENTRE_MANAGER", "STABLE_MANAGER", "HEAD_COACH"] as const;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export type FailedItem = { label: string; section: string | null; remarks: string | null };

export async function checklistAlertRecipients(centreId: string, excludeUserId: string) {
  const centre = await prisma.centre.findUnique({
    where: { id: centreId },
    select: { name: true, orgId: true, managerId: true },
  });
  if (!centre) return { centre: null, users: [] as { id: string; email: string }[] };
  const users = await prisma.user.findMany({
    where: {
      status: "active",
      id: { not: excludeUserId },
      OR: [
        { centreId, role: { in: [...CENTRE_ROLES] } },
        ...(centre.managerId ? [{ id: centre.managerId }] : []),
        // HQ has centreId = null: find them by organisation, not by centre.
        { role: { in: ["SUPER_ADMIN", "ADMIN"] }, OR: [{ orgId: centre.orgId }, { centre: { orgId: centre.orgId } }] },
      ],
    },
    select: { id: true, email: true },
  });
  return { centre, users };
}

export async function alertChecklistIssues(opts: {
  submissionId: string;
  centreId: string;
  submitterId: string;
  submitterName: string;
  shift: string | null;
  horseName: string | null;
  failed: FailedItem[];
  generalNotes: string | null;
}) {
  if (opts.failed.length === 0) return { notified: 0, emailed: 0 };

  const { centre, users } = await checklistAlertRecipients(opts.centreId, opts.submitterId);
  if (!centre || users.length === 0) return { notified: 0, emailed: 0 };

  const n = opts.failed.length;
  const what = opts.horseName ? `${opts.horseName}'s report` : `${opts.shift ?? "daily"} checklist`;
  const title = `${n} check${n === 1 ? "" : "s"} not done: ${opts.submitterName}'s ${what}`;
  const shown = opts.failed.slice(0, 3).map((f) => f.label);
  const body = shown.join(" · ") + (n > shown.length ? ` · +${n - shown.length} more` : "");
  const link = `/checklists/submissions/${opts.submissionId}`;

  await notifyMany(
    users.map((u) => u.id),
    {
      centreId: opts.centreId,
      type: "checklist.issues",
      title,
      body,
      link,
      payload: { submissionId: opts.submissionId, failed: n },
    },
  );

  // Email: only where a link can be built — an email pointing nowhere is
  // worse than none, and the in-app alert has already gone.
  if (!hasBaseUrl()) return { notified: users.length, emailed: 0 };
  const rows = opts.failed
    .map(
      (f) =>
        `<li><b>${escapeHtml(f.label)}</b>${f.section ? ` <span style="color:#6b7280;">(${escapeHtml(f.section)})</span>` : ""}${
          f.remarks ? `<br><span style="color:#444;">Remark: ${escapeHtml(f.remarks)}</span>` : ""
        }</li>`,
    )
    .join("");
  const html = renderEmail({
    centreName: centre.name,
    heading: `${n} check${n === 1 ? "" : "s"} marked not done`,
    body: `<p><b>${escapeHtml(opts.submitterName)}</b> submitted the ${escapeHtml(what)} with these checks not done:</p>
<ul style="padding-left:18px;">${rows}</ul>${
      opts.generalNotes
        ? `<p>Notes: <i>${escapeHtml(opts.generalNotes)}</i></p>`
        : ""
    }`,
    ctaText: "Open the full report",
    ctaUrl: absoluteUrl(link),
  });

  let emailed = 0;
  await Promise.all(
    users.map(async (u) => {
      if (!isValidEmail(u.email)) return;
      if (!allowsChannel(await getNotifPrefs(u.id), "email")) return;
      const r = await sendEmail({
        to: u.email,
        subject: `⚠️ ${title}`,
        html,
        ref: { type: "checklist.issues", rowId: opts.submissionId },
      });
      if (r.ok) emailed += 1;
    }),
  );
  return { notified: users.length, emailed };
}
