import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { audit } from "@/lib/audit";
import { levelLadder } from "@/lib/exam-booking";

// POST /api/riders/levels — set many riders' current level at once.
//
// A club moving onto the system brings riders who already hold a level. The
// only way to record it was the rider profile, one child at a time, so a
// school with 300 returning riders booked them all as beginners (and every
// booking then warned "skips a level"). This takes a whole sheet of changes.
//
// It records a level already held; it issues no certificate — a pass on the
// day does that. Levels must be ones on this centre's ladder, so the exam
// booking rules can read them.
const schema = z.object({
  centreId: z.string().optional(),
  changes: z
    .array(z.object({ riderId: z.string().min(1), level: z.string().trim().min(1).max(80).nullable() }))
    .min(1)
    .max(1000),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.schedule")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const resolved = await resolveWriteCentre(session, body);
  if (resolved.error) return resolved.error;
  const { centreId } = resolved;

  const changes = new Map(parsed.data.changes.map((c) => [c.riderId, c.level]));
  const ladder = await levelLadder(prisma, centreId);
  const unknown = Array.from(new Set(Array.from(changes.values()).filter((l): l is string => l !== null && !ladder.byName.has(l))));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: "UNKNOWN_LEVEL", message: `Not a level at this centre: ${unknown.join(", ")}.` },
      { status: 400 },
    );
  }
  // Centre fence on the query, not on trusting the ids in the body.
  const riders = await prisma.rider.findMany({
    where: { id: { in: Array.from(changes.keys()) }, centreId },
    select: { id: true, currentLevel: true },
  });
  if (riders.length !== changes.size) {
    return NextResponse.json({ error: "RIDER_SCOPE_MISMATCH", message: "Some riders don't belong to this centre." }, { status: 400 });
  }
  const moved = riders.filter((r) => r.currentLevel !== changes.get(r.id));
  const byLevel = new Map<string | null, string[]>();
  for (const r of moved) {
    const l = changes.get(r.id)!;
    byLevel.set(l, [...(byLevel.get(l) ?? []), r.id]);
  }
  await prisma.$transaction(
    Array.from(byLevel.entries()).map(([level, ids]) =>
      prisma.rider.updateMany({ where: { id: { in: ids }, centreId }, data: { currentLevel: level } }),
    ),
  );
  if (moved.length > 0) {
    await audit({
      userId: session.userId,
      action: "rider.bulk_set_level",
      tableName: "rider",
      rowId: centreId,
      before: { riders: moved.map((r) => ({ id: r.id, level: r.currentLevel })) },
      after: { riders: moved.map((r) => ({ id: r.id, level: changes.get(r.id) })) },
    });
  }
  return NextResponse.json({ ok: true, updated: moved.length, unchanged: riders.length - moved.length });
}
