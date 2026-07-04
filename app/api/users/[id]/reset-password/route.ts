import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { callerSharesOrgWithUser } from "@/lib/authz-org";

// POST /api/users/[id]/reset-password — HQ resets a user's password.
// Two modes:
//   • No body (default) — generate a fresh temporary password. The plaintext
//     temp is returned ONCE in the response and the user must rotate it at
//     next sign-in (mustChangePassword).
//   • { password: "..." } — set the given password verbatim (admin chose it
//     deliberately, e.g. a club-standard onboarding password), no forced
//     rotation. Still audited, still SUPER_ADMIN-only.
const bodySchema = z.object({ password: z.string().min(8, "8+ chars").max(72) }).partial();

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  // Body is optional (legacy callers send none). An invalid explicit password
  // (too short) is a 400 rather than silently falling back to generate.
  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const manual = parsed.data.password;

  const target = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, email: true } });
  if (!target) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!(await callerSharesOrgWithUser(session, target.id))) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }

  // 12 bytes base64url ≈ 16 chars; safe to copy/paste in WhatsApp/email.
  const tempPassword = manual ?? crypto.randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  await prisma.user.update({
    where: { id: target.id },
    // A generated temp is a handoff secret — force rotation. A manually set
    // password was chosen on purpose; don't force the user to change it.
    data: { passwordHash, mustChangePassword: !manual },
  });

  await audit({
    userId: session.userId,
    action: "user.reset_password",
    tableName: "user",
    rowId: target.id,
    after: { email: target.email, mode: manual ? "manual" : "generated" },
  });

  // Never echo a manually chosen password back — the caller already knows it.
  return NextResponse.json(manual ? { ok: true } : { ok: true, tempPassword });
}
