import { prisma } from "../prisma";
import { notify } from "../notify";
import { sendSms } from "../sms";
import { sendEmail, renderEmail } from "../email";
import { sendWhatsApp } from "../whatsapp";
import { SweepResult, centreManagerMap, recentlyNotified } from "./shared";

// ─────────────────────────────────────────────────────────────────────────────
// Job 4: Birthday wishes.
// Spec §4.22 lists "birthday wishes → rider (engagement)". Notification routes to the
// centre manager (who can then arrange a card / WhatsApp); a parent-direct channel
// is what the SMS dispatch upgrade will unlock.
export async function sweepBirthdays(): Promise<SweepResult> {
  const today = new Date();
  const mm = today.getMonth();
  const dd = today.getDate();

  // SQLite doesn't have month()/day() out of the box via Prisma — fetch active
  // riders and filter in JS. With ~hundreds of riders, this is fine.
  const riders = await prisma.rider.findMany({
    where: { status: "active" },
    select: { id: true, firstName: true, lastName: true, centreId: true, dob: true },
  });

  let notified = 0;
  let skipped = 0;
  const birthdayKids = riders.filter((r) => {
    const dob = new Date(r.dob);
    return dob.getMonth() === mm && dob.getDate() === dd;
  });

  // Need phone + email for SMS/email — fetch with the extra fields.
  const fullRiders = await prisma.rider.findMany({
    where: { id: { in: birthdayKids.map((r) => r.id) } },
    select: { id: true, firstName: true, lastName: true, centreId: true, dob: true, mobile: true, fatherPhone: true, motherPhone: true, email: true, centre: { select: { name: true } } },
  });
  // One centre lookup for the whole batch instead of one per birthday kid.
  const managers = await centreManagerMap(fullRiders.map((r) => r.centreId));
  for (const r of fullRiders) {
    const mgrId = managers.get(r.centreId) ?? null;
    if (!mgrId) {
      skipped += 1;
      continue;
    }
    if (await recentlyNotified(mgrId, "rider.birthday", r.id, 23 * 60 * 60 * 1000)) {
      skipped += 1;
      continue;
    }
    const age = today.getFullYear() - new Date(r.dob).getFullYear();
    await notify({
      userId: mgrId,
      centreId: r.centreId,
      type: "rider.birthday",
      title: `🎂 ${r.firstName} ${r.lastName} turns ${age} today`,
      body: `Send a card or WhatsApp greeting — the easy engagement win.`,
      link: `/riders/${r.id}`,
      payload: { riderId: r.id, age },
    });
    // Parent SMS — best-of-engagement nudge.
    const parentPhone = r.fatherPhone ?? r.motherPhone ?? r.mobile;
    await sendSms({
      to: parentPhone,
      body: `Happy Birthday ${r.firstName}! 🎂 Wishing you a wonderful ${age}th year — see you at the stables. — Team Equiwings`,
      ref: { type: "rider.birthday", rowId: r.id, payload: { age } },
    });
    // Parent WhatsApp — pre-approved template `ew_birthday`.
    await sendWhatsApp({
      to: parentPhone,
      centreId: r.centreId,
      template: { name: "ew_birthday", bodyParams: [r.firstName, String(age)] },
      previewBody: `Happy Birthday ${r.firstName} — ${age} 🎂`,
      ref: { type: "rider.birthday", rowId: r.id, payload: { age } },
    });
    // Parent email — warmer engagement piece.
    if (r.email) {
      await sendEmail({
        to: r.email,
        subject: `🎂 Happy Birthday ${r.firstName}!`,
        html: renderEmail({
          centreName: r.centre.name,
          heading: `Happy ${age}th Birthday, ${r.firstName}! 🎂`,
          body: `<p>Dear ${r.firstName},</p>
<p>Everyone at ${r.centre.name} is sending you the warmest birthday wishes today. We can't wait to see you at the stables for another year of riding adventures together.</p>
<p style="font-size:32px;text-align:center;margin:24px 0;">🐎  🥇  🎉</p>
<p>— Team Equiwings</p>`,
        }),
        ref: { type: "rider.birthday", rowId: r.id, payload: { age } },
      });
    }
    notified += 1;
  }

  return { job: "birthdays", scanned: riders.length, notified, skipped };
}
