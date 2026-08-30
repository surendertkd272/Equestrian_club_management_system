import { prisma } from "./prisma";
import type { Role } from "./roles";
import { getNotifPrefs, allowsChannel } from "./notify-prefs";

// Notification "criticality" — critical alerts ignore preferences entirely
// (severe injury, password reset). Non-critical respects the user's per-
// channel toggle. Default = false.
type NotifCriticality = "critical" | "normal";

export type NotifyInput = {
  userId: string;
  centreId?: string | null;
  type: string;
  title: string;
  body: string;
  link?: string;
  channel?: "in_app" | "sms" | "email" | "whatsapp";
  payload?: unknown;
};

// Single-recipient. Returns the created row; failures don't throw so a caller can fire-and-forget.
//
// Honors the recipient's notifPrefs for in-app delivery when `criticality`
// is "normal" (default). "critical" messages always land in the inbox so
// password resets / severe-injury alerts can't be muted into oblivion.
export async function notify(input: NotifyInput & { criticality?: NotifCriticality }) {
  try {
    if ((input.criticality ?? "normal") !== "critical" && (input.channel ?? "in_app") === "in_app") {
      const prefs = await getNotifPrefs(input.userId);
      if (!allowsChannel(prefs, "inApp")) return null;
    }
    return await prisma.notification.create({
      data: {
        userId: input.userId,
        centreId: input.centreId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
        channel: input.channel ?? "in_app",
        payload: input.payload ? JSON.stringify(input.payload) : null,
      },
    });
  } catch (err) {
    // Never let a notify failure kill the parent transaction. Log and move on.
    console.warn("[notify] failed:", err);
    return null;
  }
}

// Multi-recipient. Each row independent so a partial failure still delivers to others.
export async function notifyMany(
  userIds: string[],
  rest: Omit<NotifyInput, "userId"> & { criticality?: NotifCriticality },
) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  await Promise.all(unique.map((userId) => notify({ ...rest, userId })));
}

// Broadcast to everyone in a role within a centre. Useful for "centre manager" / "vet" / "examiner" buckets.
export async function notifyRole(role: Role, rest: Omit<NotifyInput, "userId"> & { centreId: string }) {
  const users = await prisma.user.findMany({
    where: { role, centreId: rest.centreId, status: "active" },
    select: { id: true },
  });
  await notifyMany(
    users.map((u) => u.id),
    rest,
  );
}

// Notify the HQ tier of an ORGANISATION.
//
// Not expressible with notifyRole(), and the reason is a recurring bug class
// here: HQ users have centreId = null, so any lookup filtered by centre finds
// nobody and the notification silently goes nowhere. Resolve them by org
// instead — directly via User.orgId for HQ rows, or via their centre's org for
// anyone who has one.
export async function notifyHq(
  orgId: string,
  rest: Omit<NotifyInput, "userId"> & { centreId?: string | null },
) {
  const users = await prisma.user.findMany({
    where: {
      role: { in: ["SUPER_ADMIN", "ADMIN"] },
      status: "active",
      OR: [{ orgId }, { centre: { orgId } }],
    },
    select: { id: true },
  });
  await notifyMany(
    users.map((u) => u.id),
    rest,
  );
  return users.length;
}

// Notify the manager(s) of a centre. Centre.managerId is the single point of contact.
export async function notifyCentreManager(centreId: string, rest: Omit<NotifyInput, "userId" | "centreId">) {
  const centre = await prisma.centre.findUnique({ where: { id: centreId }, select: { managerId: true } });
  if (centre?.managerId) {
    await notify({ ...rest, userId: centre.managerId, centreId });
  }
}

// Notify every parent linked to a rider. Skips silently when the rider has no
// linked parents (parent-portal access is opt-in per family).
export async function notifyParentsOfRider(
  riderId: string,
  rest: Omit<NotifyInput, "userId">,
) {
  const links = await prisma.parentLink.findMany({
    where: { riderId },
    select: { parentUserId: true },
  });
  if (links.length === 0) return;
  await notifyMany(
    links.map((l) => l.parentUserId),
    rest,
  );
}

// Notify the rider's user account (if they have portal access) AND every linked
// parent. Used for events that matter to both audiences: exam result,
// certificate issuance, level promotion.
export async function notifyRiderAndParents(
  riderId: string,
  // criticality is passed through so a genuinely urgent event (a child injured
  // at the centre) reaches the family even if they have muted this category.
  rest: Omit<NotifyInput, "userId"> & { criticality?: NotifCriticality },
) {
  const rider = await prisma.rider.findUnique({
    where: { id: riderId },
    select: { userId: true, parentLinks: { select: { parentUserId: true } } },
  });
  if (!rider) return;
  const userIds = [
    ...(rider.userId ? [rider.userId] : []),
    ...rider.parentLinks.map((l) => l.parentUserId),
  ];
  if (userIds.length === 0) return;
  await notifyMany(userIds, rest);
}
