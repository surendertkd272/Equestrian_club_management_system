import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { storeIssuedCredential, revealIssuedCredential } from "@/lib/issued-credential";
import { resolveWriteCentre } from "@/lib/resolve-centre";

// The credential handover sheet for a centre.
//
// GET  — re-open the sheet: everyone at this centre still holding an unused
//        system-issued password.
// POST — issue (or re-issue) temp passwords for a set of users at once.
//
// Why this exists: onboarding a club means creating twenty accounts, and the
// temp password for each was shown exactly once. Lose the printout and the
// only remedy was resetting all twenty individually. This makes the sheet a
// thing you can re-open, and issuing a batch a single action.
//
// What it deliberately does NOT do: reveal a password a user chose. The column
// behind this is cleared the moment they set their own (lib/issued-credential),
// so a user who has signed in and rotated shows as "—", not as a secret.

// HQ only — same gate as creating a user, because that is what this is: the
// power to mint access for someone else. A CENTRE_MANAGER reading their own
// centre's sheet would be reasonable, but it is also the power to take over
// every account under them, so it stays at HQ until someone asks for it.
function hqOnly(role: string) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

const issueSchema = z.object({
  centreId: z.string().optional(),
  /** Explicit user ids. Omit to mean "everyone at the centre matching roles". */
  userIds: z.array(z.string()).max(500).optional(),
  roles: z.array(z.string()).max(30).optional(),
  /**
   * Re-issue for users who already hold an unused temp. Off by default: the
   * common case is "I lost the sheet", and those rows are already readable —
   * resetting them would invalidate passwords that were handed out and are
   * working.
   */
  includeAlreadyIssued: z.boolean().default(false),
  /**
   * Count who would be affected without touching anything.
   *
   * Needed because "issue for anyone without a stored credential" means
   * EVERYONE until this feature has been used once — the column starts null on
   * every pre-existing row. Without a preview, the first click of a button
   * labelled "issue for new staff" would reset a whole club's passwords and
   * sign them all out.
   */
  dryRun: z.boolean().default(false),
});

/** Never mint credentials for these — they are not staff accounts. */
const EXCLUDED_ROLES = ["SUPER_ADMIN", "ADMIN"];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!hqOnly(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const url = new URL(req.url);
  const resolved = await resolveWriteCentre(session, {
    centreId: url.searchParams.get("centreId") ?? undefined,
  });
  if (resolved.error) return resolved.error;

  const rows = await prisma.user.findMany({
    where: {
      centreId: resolved.centreId,
      role: { notIn: EXCLUDED_ROLES },
      issuedPasswordEnc: { not: null },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      issuedPasswordEnc: true,
      issuedPasswordAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  // Reading a batch of live credentials is a privileged act, so it leaves a
  // record naming the reader — not just the fact that a page was opened.
  await audit({
    userId: session.userId,
    action: "user.credentials_revealed",
    tableName: "user",
    rowId: resolved.centreId,
    after: { count: rows.length, userIds: rows.map((r) => r.id) },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    centreId: resolved.centreId,
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      status: r.status,
      issuedAt: r.issuedPasswordAt,
      password: revealIssuedCredential(r.issuedPasswordEnc),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!hqOnly(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = issueSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const resolved = await resolveWriteCentre(session, { centreId: d.centreId });
  if (resolved.error) return resolved.error;

  const targets = await prisma.user.findMany({
    where: {
      // Centre-scoped, ALWAYS — this is the fence that stops an id from
      // another club being slipped into userIds.
      centreId: resolved.centreId,
      role: { notIn: EXCLUDED_ROLES },
      ...(d.userIds?.length ? { id: { in: d.userIds } } : {}),
      ...(d.roles?.length ? { role: { in: d.roles } } : {}),
      ...(d.includeAlreadyIssued ? {} : { issuedPasswordEnc: null }),
    },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  if (d.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      centreId: resolved.centreId,
      wouldAffect: targets.length,
      names: targets.slice(0, 20).map((t) => t.name),
    });
  }

  const issued: Array<{ id: string; name: string; email: string; role: string; password: string }> = [];
  for (const t of targets) {
    const tempPassword = crypto.randomBytes(12).toString("base64url");
    const passwordHash = await hashPassword(tempPassword);
    await prisma.user.update({
      where: { id: t.id },
      // Bump tokenVersion: issuing a new password must kill sessions still
      // running on the old one, or a departed employee keeps their access.
      data: { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 } },
    });
    await storeIssuedCredential(prisma, t.id, tempPassword, session.userId);
    issued.push({ ...t, password: tempPassword });
  }

  await audit({
    userId: session.userId,
    action: "user.credentials_issued",
    tableName: "user",
    rowId: resolved.centreId,
    after: { count: issued.length, userIds: issued.map((i) => i.id) },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, centreId: resolved.centreId, issued });
}
