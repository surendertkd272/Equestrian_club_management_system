import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { mergePrefs } from "@/lib/notify-prefs";

// 24h "HH:MM" string (or empty to disable quiet hours).
const hhmm = z.string().regex(/^(?:|[0-2]\d:[0-5]\d)$/, "HH:MM or empty");

const schema = z
  .object({
    inApp: z.boolean(),
    email: z.boolean(),
    sms: z.boolean(),
    whatsapp: z.boolean(),
    quietHoursStart: hhmm,
    quietHoursEnd: hhmm,
  })
  .partial()
  .strict();

// GET — return the user's current prefs with all defaults filled in.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const u = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { notifPrefsJson: true },
  });
  return NextResponse.json({ prefs: mergePrefs(u?.notifPrefsJson ?? null) });
}

// PATCH — merge incoming partial into the stored prefs. Lets the form
// submit only-changed fields without overwriting untouched ones.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const current = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: { notifPrefsJson: true },
  });
  const merged = { ...mergePrefs(current.notifPrefsJson), ...parsed.data };

  await prisma.user.update({
    where: { id: session.userId },
    // jsonb column — pass the object directly (post-migration in 81f142a).
    data: { notifPrefsJson: merged },
  });

  await audit({
    userId: session.userId,
    action: "account.notif_prefs_updated",
    tableName: "user",
    rowId: session.userId,
    after: merged,
  });

  return NextResponse.json({ ok: true, prefs: merged });
}
