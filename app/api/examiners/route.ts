import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { emailIdentity } from "@/lib/email-normalize";
import { indianMobile } from "@/lib/schemas/phone";
import { parseDateOnly } from "@/lib/schemas/attendance";
import { endOfDayInTz } from "@/lib/tz";
import { resolveCentreTz } from "@/lib/centre-tz";
import { storeIssuedCredential } from "@/lib/issued-credential";
import { isExamManager } from "@/lib/exam-panel";

// Register a VISITING examiner — a judge from outside the club, brought in for
// an exam day. Before this only HQ could create an examiner account (the staff
// screen deliberately excludes the role), so a centre running its own exam day
// had to ask HQ for every judge, and the accounts it got never expired.
//
// A visiting examiner's access ends on `accessUntil` (end of that day at the
// centre); after it, sign-in is refused and live sessions stop working.
const MAX_DAYS = 366;
const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailIdentity(),
  phone: indianMobile().optional().or(z.literal("")),
  accessUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  centreId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isExamManager(session.role)) {
    return NextResponse.json(
      { error: "FORBIDDEN", message: "Only a centre manager or HQ can register a visiting examiner." },
      { status: 403 },
    );
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION", message: parsed.error.issues[0]?.message, details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const centre = await resolveWriteCentre(session, body);
  if (centre.error) return centre.error;
  const { centreId } = centre;

  const tz = await resolveCentreTz(centreId);
  const accessExpiresAt = endOfDayInTz(parseDateOnly(d.accessUntil), tz);
  const now = Date.now();
  if (accessExpiresAt.getTime() <= now) {
    return NextResponse.json({ error: "VALIDATION", message: "The access end date has already passed." }, { status: 400 });
  }
  if (accessExpiresAt.getTime() > now + MAX_DAYS * 86400000) {
    return NextResponse.json(
      { error: "VALIDATION", message: "A visiting examiner's access can be set at most a year ahead." },
      { status: 400 },
    );
  }
  const centreRow = await prisma.centre.findUnique({ where: { id: centreId }, select: { orgId: true } });

  // The same judge often comes back for the next exam day. An examiner account
  // on this organisation is reactivated and given the new end date rather than
  // refused as a duplicate email.
  const existing = await prisma.user.findUnique({
    where: { email: d.email },
    select: { id: true, role: true, orgId: true, centreId: true, accessExpiresAt: true, centre: { select: { orgId: true } } },
  });
  if (existing) {
    const sameOrg = (existing.orgId ?? existing.centre?.orgId) === centreRow?.orgId;
    const visiting = existing.role === "EXAMINER" && (existing.accessExpiresAt !== null || existing.centreId === centreId);
    if (!sameOrg || !visiting) {
      return NextResponse.json(
        { error: "EMAIL_IN_USE", message: "That email already belongs to another account. Use the judge's own email address." },
        { status: 409 },
      );
    }
    await prisma.user.update({
      where: { id: existing.id },
      data: { status: "active", centreId, accessExpiresAt, ...(d.phone ? { phone: d.phone } : {}) },
    });
    await audit({
      userId: session.userId,
      action: "examiner.visiting_reactivated",
      tableName: "user",
      rowId: existing.id,
      before: { centreId: existing.centreId, accessExpiresAt: existing.accessExpiresAt },
      after: { centreId, accessExpiresAt },
    });
    return NextResponse.json({ ok: true, id: existing.id, reactivated: true, accessExpiresAt });
  }

  const tempPassword = crypto.randomBytes(9).toString("base64url");
  const user = await prisma.user.create({
    data: {
      name: d.name,
      email: d.email,
      phone: d.phone || null,
      role: "EXAMINER",
      centreId,
      orgId: centreRow?.orgId ?? null,
      status: "active",
      passwordHash: await hashPassword(tempPassword),
      // Set on first sign-in; the API refuses them until they do.
      mustChangePassword: true,
      // The centre vouches for the address, as for any admin-created account.
      emailVerifiedAt: new Date(),
      accessExpiresAt,
    },
  });
  await storeIssuedCredential(prisma, user.id, tempPassword, session.userId);
  await audit({
    userId: session.userId,
    action: "examiner.visiting_registered",
    tableName: "user",
    rowId: user.id,
    after: { name: d.name, email: d.email, centreId, accessExpiresAt },
  });
  // The temporary password is returned ONCE so the manager can hand it to the
  // judge; it is also kept in the credential vault.
  return NextResponse.json({ ok: true, id: user.id, email: d.email, tempPassword, accessExpiresAt }, { status: 201 });
}
