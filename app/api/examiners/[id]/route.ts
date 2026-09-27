import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { centreFence } from "@/lib/authz-centre";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { parseDateOnly } from "@/lib/schemas/attendance";
import { endOfDayInTz } from "@/lib/tz";
import { resolveCentreTz } from "@/lib/centre-tz";
import { storeIssuedCredential } from "@/lib/issued-credential";
import { isExamManager } from "@/lib/exam-panel";

// Manage a visiting examiner: extend (or change) their access end date, end
// it now — live sessions stop at once — or issue a fresh temporary password
// for a judge who lost theirs on the morning of the exam.
const schema = z
  .object({
    accessUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endNow: z.literal(true).optional(),
    resetPassword: z.literal(true).optional(),
  })
  .refine((v) => [v.accessUntil, v.endNow, v.resetPassword].filter(Boolean).length === 1, {
    message: "Give exactly one of accessUntil, endNow or resetPassword.",
  });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!isExamManager(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const d = parsed.data;
  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, role: true, centreId: true, accessExpiresAt: true, tokenVersion: true },
  });
  if (!target || target.role !== "EXAMINER" || !target.centreId) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const fence = await centreFence(session, target.centreId);
  if (fence) return NextResponse.json({ error: fence }, { status: 403 });

  if (d.resetPassword) {
    const tempPassword = crypto.randomBytes(9).toString("base64url");
    await prisma.user.update({
      where: { id: target.id },
      data: {
        passwordHash: await hashPassword(tempPassword),
        mustChangePassword: true,
        // Signs out every device still holding the old password's session.
        tokenVersion: { increment: 1 },
      },
    });
    await storeIssuedCredential(prisma, target.id, tempPassword, session.userId);
    await audit({ userId: session.userId, action: "examiner.password_reset", tableName: "user", rowId: target.id });
    return NextResponse.json({ ok: true, tempPassword });
  }

  let accessExpiresAt: Date;
  if (d.endNow) {
    accessExpiresAt = new Date();
  } else {
    accessExpiresAt = endOfDayInTz(parseDateOnly(d.accessUntil!), await resolveCentreTz(target.centreId));
    if (accessExpiresAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "VALIDATION", message: "That date has passed — use “End access now” instead." },
        { status: 400 },
      );
    }
  }
  await prisma.user.update({ where: { id: target.id }, data: { accessExpiresAt, status: "active" } });
  await audit({
    userId: session.userId,
    action: d.endNow ? "examiner.access_ended" : "examiner.access_changed",
    tableName: "user",
    rowId: target.id,
    before: { accessExpiresAt: target.accessExpiresAt },
    after: { accessExpiresAt },
  });
  return NextResponse.json({ ok: true, accessExpiresAt });
}
