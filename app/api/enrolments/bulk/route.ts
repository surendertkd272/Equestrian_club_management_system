import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { APPROVER_ROLES, VERIFIER_ROLES, decideEnrolment } from "@/lib/enrolment-decision";

// POST /api/enrolments/bulk — decide many pending enrolments at once.
//
// A school sign-up drive puts 150 families in the queue in an afternoon, and
// each one took two clicks on its own row (verify, then approve). This runs
// the same per-rider decision (lib/enrolment-decision.ts) over a batch, so
// every rule — centre and school fences, the document check, the invoice and
// the family message — still applies to each rider.
//
// "verify_approve" is the manager attesting, in one confirmed step, that they
// checked every selected rider's documents; each rider's verification is
// recorded against them with a note saying it was a bulk review.
//
// Small batches (the page sends 25 at a time): each approval can send an SMS,
// a WhatsApp and an email, and a request must finish well inside the
// function time limit.
const schema = z.object({
  riderIds: z.array(z.string().min(1)).min(1).max(50),
  action: z.enum(["verify_approve", "approve", "reject"]),
  reason: z.string().max(300).optional(),
  // Required for verify_approve: the manager confirmed they checked documents.
  attested: z.literal(true).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!APPROVER_ROLES.has(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const d = parsed.data;
  if (d.action === "verify_approve") {
    if (!VERIFIER_ROLES.has(session.role)) {
      return NextResponse.json(
        { error: "FORBIDDEN", message: "Only HQ or the centre manager can verify documents." },
        { status: 403 },
      );
    }
    if (!d.attested) {
      return NextResponse.json(
        { error: "NOT_ATTESTED", message: "Confirm you checked every selected rider's documents." },
        { status: 400 },
      );
    }
  }
  const meta = { ip: req.headers.get("x-forwarded-for"), userAgent: req.headers.get("user-agent") };
  const ids = Array.from(new Set(d.riderIds));
  const names = new Map(
    (await prisma.rider.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })).map(
      (r) => [r.id, `${r.firstName} ${r.lastName}`],
    ),
  );

  const done: string[] = [];
  const skipped: { id: string; name: string; reason: string }[] = [];
  for (const id of ids) {
    const name = names.get(id) ?? "Unknown rider";
    if (d.action === "verify_approve") {
      const rider = await prisma.rider.findUnique({ where: { id }, select: { verifiedAt: true } });
      if (rider && !rider.verifiedAt) {
        const v = await decideEnrolment(
          session,
          id,
          { action: "verify", note: `Bulk review — checked with ${ids.length - 1} other${ids.length === 2 ? "" : "s"}` },
          meta,
        );
        if (v.status !== 200) {
          skipped.push({ id, name, reason: String(v.body.message ?? v.body.error) });
          continue;
        }
      }
    }
    const r = await decideEnrolment(
      session,
      id,
      { action: d.action === "reject" ? "reject" : "approve", reason: d.reason },
      meta,
    );
    if (r.status === 200) done.push(id);
    else skipped.push({ id, name, reason: String(r.body.message ?? r.body.error) });
  }

  await audit({
    userId: session.userId,
    action: `enrolment.bulk_${d.action}`,
    tableName: "rider",
    rowId: done[0] ?? ids[0],
    after: { requested: ids.length, done: done.length, skipped: skipped.map((s) => ({ id: s.id, reason: s.reason })) },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return NextResponse.json({ ok: true, done: done.length, skipped });
}
