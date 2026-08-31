import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { audit } from "@/lib/audit";
import { storeIssuedCredential } from "@/lib/issued-credential";
import { consentRecipient } from "@/lib/rider-consent-request";
import { isValidEmail } from "@/lib/email";

// Portal logins for a whole centre's riders at once.
//
// Zero riders in a hundred had a login, and creating them one at a time —
// typing an address per rider — is why. This resolves the address the same way
// the consent flow does (rider's own, then a linked parent, then the parental
// consent block), so a club that captured parent emails at registration or in
// the import sheet gets logins without retyping anything.
//
// Deliberately does NOT invent an address. A rider with none is reported by
// name; a login keyed on a made-up email is worse than no login.

const ROLES = new Set(["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"]);

const schema = z.object({
  centreId: z.string().optional(),
  riderIds: z.array(z.string()).max(500).optional(),
  /** Count who would get one, without creating anything. */
  dryRun: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!ROLES.has(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const resolved = await resolveWriteCentre(session, { centreId: d.centreId });
  if (resolved.error) return resolved.error;

  const riders = await prisma.rider.findMany({
    where: {
      // Centre fence on the query, not on the caller remembering to filter.
      centreId: resolved.centreId,
      userId: null,
      status: { notIn: ["withdrawn", "rejected", "cancelled"] },
      ...(d.riderIds?.length ? { id: { in: d.riderIds } } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      parentalConsentJson: true,
      parentLinks: { select: { parent: { select: { email: true } } } },
    },
    orderBy: [{ firstName: "asc" }],
  });

  const created: { id: string; name: string; email: string; password: string }[] = [];
  const noEmail: { id: string; name: string }[] = [];
  const emailTaken: { id: string; name: string; email: string }[] = [];

  for (const r of riders) {
    const name = `${r.firstName} ${r.lastName}`;
    const email = consentRecipient(r);
    if (!email || !isValidEmail(email)) {
      // Named, not silently dropped — these are the ones needing an address
      // collected before they can ever have a login.
      noEmail.push({ id: r.id, name });
      continue;
    }
    if (d.dryRun) {
      created.push({ id: r.id, name, email, password: "" });
      continue;
    }
    // User.email is globally unique. A shared family address across siblings
    // is completely normal, so this is an expected outcome rather than an
    // error — report it and move on instead of aborting the batch.
    const dupe = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (dupe) {
      emailTaken.push({ id: r.id, name, email });
      continue;
    }

    const tempPassword = crypto.randomBytes(12).toString("base64url");
    const user = await prisma.user.create({
      data: {
        emailVerifiedAt: new Date(),
        email,
        name,
        role: "RIDER",
        centreId: resolved.centreId,
        passwordHash: await hashPassword(tempPassword),
        mustChangePassword: true,
      },
    });
    await prisma.rider.update({ where: { id: r.id }, data: { userId: user.id } });
    // Onto the credential sheet, so the logins can be handed over later
    // instead of being shown once and lost.
    await storeIssuedCredential(prisma, user.id, tempPassword, session.userId);
    created.push({ id: r.id, name, email, password: tempPassword });
  }

  if (d.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldCreate: created.length,
      noEmail,
      names: created.slice(0, 20).map((c) => c.name),
    });
  }

  await audit({
    userId: session.userId,
    action: "rider.portal_access_bulk",
    tableName: "rider",
    rowId: resolved.centreId,
    after: { created: created.length, noEmail: noEmail.length, emailTaken: emailTaken.length },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, created, noEmail, emailTaken });
}
