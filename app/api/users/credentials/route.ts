import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { storeIssuedCredential, revealIssuedCredential } from "@/lib/issued-credential";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { getOrgIdForSession } from "@/lib/features-gate";

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

// Onboarding a multi-centre client is the same job at every club, and clicking
// through them one at a time invites doing four and forgetting the fifth. So
// "every centre" is expressible — but only as an EXPLICIT sentinel, never as
// the default. A missing or empty centreId still goes through
// resolveWriteCentre, so a dropped parameter can never silently widen a
// single-club action into a platform-wide password reset.
const ALL_CENTRES = "__all__";

/**
 * Resolve the centre filter for a request. Org-fenced on both branches, and
 * always returns a bounded clause — "all centres" becomes an explicit list of
 * THIS org's centre ids, never an absent filter.
 */
async function resolveScope(
  session: Parameters<typeof resolveWriteCentre>[0],
  requested: string | undefined,
): Promise<
  | { where: { centreId: string | { in: string[] } }; label: string; error?: never }
  | { error: NextResponse; where?: never; label?: never }
> {
  if (requested === ALL_CENTRES) {
    const orgId = await getOrgIdForSession(session);
    // Fail closed: without a resolvable org we cannot prove which centres
    // belong to the caller, and "all centres" must never become "all tenants".
    if (!orgId) return { error: NextResponse.json({ error: "NO_ORG" }, { status: 403 }) };
    const centres = await prisma.centre.findMany({ where: { orgId }, select: { id: true } });
    return {
      where: { centreId: { in: centres.map((c) => c.id) } },
      label: `all-centres (${centres.length})`,
    };
  }
  const resolved = await resolveWriteCentre(session, { centreId: requested });
  if (resolved.error) return { error: resolved.error };
  return { where: { centreId: resolved.centreId }, label: resolved.centreId };
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
  /**
   * Give the whole batch ONE password instead of one each.
   *
   * The real request behind this: handing a club a list where every row has a
   * different string is awkward to communicate — "here is your password" is a
   * single sentence, forty-seven of them is a spreadsheet nobody reads
   * properly. That ergonomic need is legitimate.
   *
   * What it is NOT is a licence to use a guessable word. The shared value is
   * still generated (see sharedPassword()), so it is unguessable, and every
   * account still carries mustChangePassword — the first thing each person
   * does is replace it. The exposure is "one club's staff share a strong
   * string for a few days", not "anyone who knows an email address is in".
   */
  shared: z.boolean().default(false),
});

/**
 * One strong password for a whole onboarding batch.
 *
 * Readable on purpose — this gets spoken aloud, written on a whiteboard, and
 * retyped on a phone, so ambiguous glyphs are removed rather than trusting
 * people to distinguish O from 0. Roughly 57 bits from the random half, which
 * is far past anything guessable while still being one short line to dictate.
 */
function sharedPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O
  const digits = "23456789"; // no 0 or 1
  const pick = (set: string, n: number) =>
    Array.from({ length: n }, () => set[crypto.randomInt(set.length)]).join("");
  return `${pick(alphabet, 4)}-${pick(digits, 4)}-${pick(alphabet, 4)}`;
}

/** Never mint credentials for these — they are not staff accounts. */
const EXCLUDED_ROLES = ["SUPER_ADMIN", "ADMIN"];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!hqOnly(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const url = new URL(req.url);
  const scope = await resolveScope(session, url.searchParams.get("centreId") ?? undefined);
  if (scope.error) return scope.error;

  const rows = await prisma.user.findMany({
    where: {
      ...scope.where,
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
      centre: { select: { name: true } },
    },
    orderBy: [{ centreId: "asc" }, { role: "asc" }, { name: "asc" }],
  });

  // Reading a batch of live credentials is a privileged act, so it leaves a
  // record naming the reader — not just the fact that a page was opened.
  await audit({
    userId: session.userId,
    action: "user.credentials_revealed",
    tableName: "user",
    rowId: scope.label,
    after: { count: rows.length, userIds: rows.map((r) => r.id) },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    scope: scope.label,
    rows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      status: r.status,
      centre: r.centre?.name ?? "—",
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

  const scope = await resolveScope(session, d.centreId);
  if (scope.error) return scope.error;

  const targets = await prisma.user.findMany({
    where: {
      // Centre-scoped, ALWAYS — this is the fence that stops an id from
      // another club being slipped into userIds. Even the all-centres branch
      // resolves to an explicit list of THIS org's centre ids, never to an
      // absent filter.
      ...scope.where,
      role: { notIn: EXCLUDED_ROLES },
      ...(d.userIds?.length ? { id: { in: d.userIds } } : {}),
      ...(d.roles?.length ? { role: { in: d.roles } } : {}),
      ...(d.includeAlreadyIssued ? {} : { issuedPasswordEnc: null }),
    },
    select: { id: true, name: true, email: true, role: true, centre: { select: { name: true } } },
    orderBy: [{ centreId: "asc" }, { role: "asc" }, { name: "asc" }],
  });

  if (d.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      scope: scope.label,
      wouldAffect: targets.length,
      names: targets.slice(0, 20).map((t) => t.name),
    });
  }

  const issued: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    centre: string;
    password: string;
  }> = [];

  // One value for the batch, or one each. Computed once outside the loop so a
  // shared batch really is shared.
  const batchPassword = d.shared ? sharedPassword() : null;

  for (const t of targets) {
    const tempPassword = batchPassword ?? crypto.randomBytes(12).toString("base64url");
    const passwordHash = await hashPassword(tempPassword);
    await prisma.user.update({
      where: { id: t.id },
      // Bump tokenVersion: issuing a new password must kill sessions still
      // running on the old one, or a departed employee keeps their access.
      data: { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 } },
    });
    await storeIssuedCredential(prisma, t.id, tempPassword, session.userId);
    issued.push({ ...t, centre: t.centre?.name ?? "—", password: tempPassword });
  }

  await audit({
    userId: session.userId,
    action: "user.credentials_issued",
    tableName: "user",
    rowId: scope.label,
    // Record that this batch shared one password. If it ever has to be
    // investigated, "could another member of staff have signed in as them"
    // has a different answer for a shared batch, and the log should say so.
    after: { count: issued.length, shared: d.shared, userIds: issued.map((i) => i.id) },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    scope: scope.label,
    sharedPassword: batchPassword,
    issued,
  });
}
