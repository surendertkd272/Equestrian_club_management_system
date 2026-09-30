import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { centreFence } from "@/lib/authz-centre";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { announceResults } from "@/lib/exam-panel";

// Hold an exam day's (or a sitting's) results back from families, or publish
// them. A result reached the parent the moment the last judge submitted —
// before anyone could check the day, so a mark corrected an hour later had
// already been sent as the wrong result. Holding keeps marked results off the
// parent, student and school views and sends no messages; publishing shows
// them all and sends every family their result at once.
const schema = z.object({
  action: z.enum(["hold", "publish"]),
  scope: z.enum(["sitting", "day"]),
  id: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "exam.schedule")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  const d = parsed.data;

  const sittings =
    d.scope === "sitting"
      ? await prisma.examSitting.findMany({ where: { id: d.id }, select: { id: true, centreId: true, holdResults: true, resultsPublishedAt: true } })
      : await prisma.examSitting.findMany({ where: { examDayId: d.id }, select: { id: true, centreId: true, holdResults: true, resultsPublishedAt: true } });
  const centreId =
    sittings[0]?.centreId ??
    (d.scope === "day" ? (await prisma.examDay.findUnique({ where: { id: d.id }, select: { centreId: true } }))?.centreId : undefined);
  if (!centreId) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const fence = await centreFence(session, centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });

  if (d.action === "hold") {
    // Once published, results stay published — families have already seen them.
    if (sittings.some((s) => s.resultsPublishedAt)) {
      return NextResponse.json({ error: "ALREADY_PUBLISHED", message: "These results have been published, so they can't be held again." }, { status: 409 });
    }
    await prisma.examSitting.updateMany({ where: { id: { in: sittings.map((s) => s.id) } }, data: { holdResults: true } });
    if (d.scope === "day") await prisma.examDay.update({ where: { id: d.id }, data: { holdResults: true } });
    await audit({ userId: session.userId, action: "exam.results_held", tableName: d.scope === "day" ? "examDay" : "examSitting", rowId: d.id });
    return NextResponse.json({ ok: true, held: true });
  }

  const held = sittings.filter((s) => s.holdResults && !s.resultsPublishedAt).map((s) => s.id);
  if (held.length === 0) return NextResponse.json({ ok: true, announced: 0 });
  await prisma.examSitting.updateMany({ where: { id: { in: held } }, data: { resultsPublishedAt: new Date() } });
  const marked = await prisma.exam.findMany({ where: { sittingId: { in: held }, status: "completed" }, select: { id: true } });
  const announced = await announceResults(marked.map((e) => e.id));
  await audit({
    userId: session.userId,
    action: "exam.results_published",
    tableName: d.scope === "day" ? "examDay" : "examSitting",
    rowId: d.id,
    after: { sittings: held.length, announced },
  });
  return NextResponse.json({ ok: true, announced });
}
