// Issue a SeparationNotice against a user (kind = termination or
// resignation_request). The user then sees the notice on their own
// /account/separation page, writes their response, and submits — at
// which point we flip User.status to resigned or terminated.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { callerSharesOrgWithUser } from "@/lib/authz-org";
import { getOrgIdForSession } from "@/lib/features-gate";

const issueSchema = z.object({
  kind: z.enum(["termination", "resignation_request"]),
  noticeText: z.string().min(10).max(2000),
  effectiveAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // HQ admins, plus the centre manager who actually runs the yard. Holding
  // this to HQ alone read well on paper but not in practice: the groom who
  // walks out on a Sunday is known to the manager, not to head office, so the
  // record stayed wrong until someone in HQ got round to it — and meanwhile
  // the departed employee kept their login, their roster slot and their
  // payroll line. A manager's reach is fenced below (own centre, staff tier
  // only, never themselves) and HQ is notified of every notice they issue,
  // so the accountability the HQ-only rule was protecting is kept.
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.role !== "CENTRE_MANAGER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = issueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, centreId: true, status: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!(await callerSharesOrgWithUser(session, target.id))) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }
  // Refuse to issue separation against active SUPER_ADMIN / ADMIN — those
  // require a separate HQ-team handoff. Centre-tier staff are fine.
  if (target.role === "SUPER_ADMIN" || target.role === "ADMIN") {
    return NextResponse.json({ error: "CANNOT_SEPARATE_HQ_USER" }, { status: 400 });
  }
  // "Staff tier only" was a claim in a comment, not a check. RIDER and PARENT
  // logins carry a centreId, so they passed the manager's centre fence — a
  // student could be sent a criticality:"critical" termination notice and an
  // /account/separation form, and answering it would suspend their portal.
  if (target.role === "RIDER" || target.role === "PARENT") {
    return NextResponse.json(
      { error: "NOT_A_STAFF_ACCOUNT", message: "That's a family login, not an employee." },
      { status: 400 },
    );
  }
  // A centre manager's reach: their own centre, staff below their own tier,
  // and never themselves. Without the peer rule two managers at one centre
  // could off-board each other; without the self rule one could walk out of
  // their own account.
  if (!isHQ) {
    if (!session.centreId || target.centreId !== session.centreId) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
    }
    if (target.id === session.userId) {
      return NextResponse.json(
        { error: "CANNOT_SEPARATE_SELF", message: "Ask HQ to process your own resignation." },
        { status: 409 },
      );
    }
    if (target.role === "CENTRE_MANAGER") {
      return NextResponse.json(
        { error: "CANNOT_SEPARATE_PEER", message: "Only HQ can off-board another centre manager." },
        { status: 403 },
      );
    }
  }
  if (target.status !== "active") {
    return NextResponse.json({ error: "USER_NOT_ACTIVE", status: target.status }, { status: 409 });
  }

  const notice = await prisma.separationNotice.create({
    data: {
      userId: target.id,
      centreId: target.centreId,
      kind: parsed.data.kind,
      noticeText: parsed.data.noticeText,
      issuedByUserId: session.userId,
      effectiveAt: parsed.data.effectiveAt
        ? new Date(parsed.data.effectiveAt)
        : new Date(Date.now() + 30 * 86400000),
    },
  });

  await audit({
    userId: session.userId,
    action: `user.${parsed.data.kind}`,
    tableName: "separationNotice",
    rowId: notice.id,
    after: { targetUserId: target.id, targetName: target.name, kind: parsed.data.kind },
  });

  // Critical-criticality notification so it doesn't get muted out — the
  // recipient needs to see this regardless of their notif prefs.
  await notify({
    userId: target.id,
    centreId: target.centreId,
    type: `separation.${parsed.data.kind}`,
    title: parsed.data.kind === "termination"
      ? "Termination notice issued"
      : "Resignation form available",
    body: parsed.data.kind === "termination"
      ? "An admin has issued a termination notice. Please review and provide your acknowledgement at /account/separation."
      : "Please submit your resignation reason at /account/separation.",
    link: "/account/separation",
    criticality: "critical",
  });

  // The trade for letting a manager issue this: HQ hears about it the moment
  // it happens, rather than discovering it in the payroll run.
  if (!isHQ) {
    // HQ users may be bound to the org by User.orgId (centreId is null for a
    // super admin) or via their centre — match either, or the alert goes
    // nowhere for exactly the people who need it.
    const callerOrgId = await getOrgIdForSession(session);
    const hq = callerOrgId
      ? await prisma.user.findMany({
          where: {
            role: { in: ["SUPER_ADMIN", "ADMIN"] },
            status: "active",
            OR: [{ orgId: callerOrgId }, { centre: { orgId: callerOrgId } }],
          },
          select: { id: true },
        })
      : [];
    await Promise.all(
      hq.map((u) =>
        notify({
          userId: u.id,
          centreId: target.centreId,
          type: "separation.issued_by_manager",
          title: `${session.name ?? "A centre manager"} issued a ${parsed.data.kind === "termination" ? "termination" : "resignation request"}`,
          body: `${target.name} (${target.role}) at their centre. Reason given: ${parsed.data.noticeText.slice(0, 160)}`,
          link: "/users",
        }),
      ),
    );
  }

  return NextResponse.json({ ok: true, id: notice.id });
}

// Withdraw a pending notice (admin changes their mind before the user submits).
const withdrawSchema = z.object({ noticeId: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  // Whoever can issue one can take it back before the employee responds —
  // otherwise a manager who mis-clicks has to ring HQ to undo it.
  const canIssue =
    session.role === "SUPER_ADMIN" || session.role === "ADMIN" || session.role === "CENTRE_MANAGER";
  if (!canIssue) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const parsed = withdrawSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const notice = await prisma.separationNotice.findUnique({
    where: { id: parsed.data.noticeId },
  });
  if (!notice) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // A manager may only withdraw notices at their own centre — and only ones
  // they could have issued in the first place. Without the target guards that
  // POST applies, a manager could simply cancel the termination notice HQ had
  // just issued against them.
  if (session.role === "CENTRE_MANAGER") {
    if (!session.centreId || notice.centreId !== session.centreId) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
    }
    if (notice.userId === session.userId) {
      return NextResponse.json(
        { error: "CANNOT_WITHDRAW_OWN", message: "You can't cancel a notice issued against you." },
        { status: 403 },
      );
    }
    const subject = await prisma.user.findUnique({ where: { id: notice.userId }, select: { role: true } });
    if (!subject || subject.role === "CENTRE_MANAGER" || subject.role === "ADMIN" || subject.role === "SUPER_ADMIN") {
      return NextResponse.json({ error: "FORBIDDEN_TARGET_TIER" }, { status: 403 });
    }
  }
  if (!(await callerSharesOrgWithUser(session, notice.userId))) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }
  if (notice.status !== "pending") {
    return NextResponse.json({ error: "ALREADY_RESOLVED" }, { status: 409 });
  }

  await prisma.separationNotice.update({
    where: { id: notice.id },
    data: { status: "withdrawn" },
  });
  await audit({
    userId: session.userId,
    action: "user.separation_withdraw",
    tableName: "separationNotice",
    rowId: notice.id,
    before: { status: "pending" },
    after: { status: "withdrawn" },
  });
  return NextResponse.json({ ok: true });
}

// PATCH /api/users/[id]/separation — close a notice the employee never answered.
//
// The whole flow assumed the departing person logs in and submits their side
// at /account/separation, which flips User.status. That is a fair assumption
// for a planned resignation and a poor one for the case this feature was built
// for: the groom who walks out on a Sunday and never comes back. Their notice
// sat "pending" for ever, so their login kept working, their Staff record kept
// reading Active, and payroll kept treating them as employed.
//
// Once the effective date has passed, the employer can close it unilaterally —
// exactly what happens on paper when a notice period expires.
const finaliseSchema = z.object({
  noticeId: z.string().min(1),
  action: z.literal("finalise"),
  note: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  if (!isHQ && session.role !== "CENTRE_MANAGER") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = finaliseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const notice = await prisma.separationNotice.findUnique({ where: { id: parsed.data.noticeId } });
  if (!notice || notice.userId !== params.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (!(await callerSharesOrgWithUser(session, notice.userId))) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }
  if (notice.status !== "pending") {
    return NextResponse.json({ error: "ALREADY_RESOLVED", status: notice.status }, { status: 409 });
  }
  // Same reach as issuing: own centre, staff tier, never themselves.
  const target = await prisma.user.findUnique({
    where: { id: notice.userId },
    select: { id: true, name: true, role: true, centreId: true, status: true },
  });
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!isHQ) {
    if (!session.centreId || target.centreId !== session.centreId) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
    }
    if (target.id === session.userId) {
      return NextResponse.json({ error: "CANNOT_SEPARATE_SELF" }, { status: 409 });
    }
    if (target.role === "CENTRE_MANAGER" || target.role === "ADMIN" || target.role === "SUPER_ADMIN") {
      return NextResponse.json({ error: "FORBIDDEN_TARGET_TIER" }, { status: 403 });
    }
  }
  // Not before the date the notice itself gave them.
  if (notice.effectiveAt && notice.effectiveAt > new Date()) {
    return NextResponse.json(
      {
        error: "NOT_YET_EFFECTIVE",
        effectiveAt: notice.effectiveAt,
        message: `This notice takes effect on ${notice.effectiveAt.toISOString().slice(0, 10)}. You can withdraw it before then, but not close it.`,
      },
      { status: 409 },
    );
  }

  const newStatus = notice.kind === "termination" ? "terminated" : "resigned";
  await prisma.$transaction([
    prisma.separationNotice.update({
      where: { id: notice.id },
      data: {
        status: "closed_unanswered",
        respondedAt: new Date(),
        responseText: parsed.data.note
          ? `Closed by ${session.name} without a response from the employee. ${parsed.data.note}`
          : `Closed by ${session.name} — the notice period expired without a response.`,
      },
    }),
    prisma.user.update({
      where: { id: target.id },
      // tokenVersion invalidates every live session, so a departed employee
      // stops being able to use the app the moment this lands.
      data: { status: newStatus, tokenVersion: { increment: 1 } },
    }),
    prisma.staff.updateMany({ where: { userId: target.id }, data: { status: newStatus } }),
  ]);

  await audit({
    userId: session.userId,
    action: `separation.${notice.kind}.closed_unanswered`,
    tableName: "separationNotice",
    rowId: notice.id,
    before: { userStatus: target.status, noticeStatus: "pending" },
    after: { userStatus: newStatus, closedBy: session.userId, note: parsed.data.note ?? null },
  });

  return NextResponse.json({ ok: true, newStatus, name: target.name });
}
