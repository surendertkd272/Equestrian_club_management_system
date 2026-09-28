import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, hashPassword } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { audit } from "@/lib/audit";
import { storeIssuedCredential } from "@/lib/issued-credential";
import { parentLoginEmail } from "@/lib/family-email";

// Parent logins for a whole centre at once.
//
// A parent login was created one child at a time from the rider page, typing
// the parent's details each time — so after a 500-rider intake almost no
// family could see results. This takes the parent from the registration form
// (name, relation, phone, email), creates ONE login per family address and
// links every sibling who shares it. Riders who already have a parent linked
// are left alone; an address that already belongs to a parent is reused.
//
// Never invents an address. A family with none is reported by name.

const ROLES = new Set(["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"]);
const RELATIONS = new Set(["father", "mother", "guardian"]);

const schema = z.object({
  centreId: z.string().optional(),
  riderIds: z.array(z.string()).max(1000).optional(),
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
      parentLinks: { none: {} },
      status: { notIn: ["withdrawn", "rejected", "cancelled"] },
      ...(d.riderIds?.length ? { id: { in: d.riderIds } } : {}),
    },
    select: {
      id: true, firstName: true, lastName: true, email: true, dob: true, userId: true,
      fatherName: true, motherName: true, fatherPhone: true, motherPhone: true,
      parentalConsentJson: true,
    },
    orderBy: [{ firstName: "asc" }],
  });

  // Group siblings by family address.
  const families = new Map<string, typeof riders>();
  const noEmail: { id: string; name: string }[] = [];
  for (const r of riders) {
    const email = parentLoginEmail(r);
    if (!email) noEmail.push({ id: r.id, name: `${r.firstName} ${r.lastName}` });
    else families.set(email, [...(families.get(email) ?? []), r]);
  }
  const existing = await prisma.user.findMany({
    where: { email: { in: Array.from(families.keys()) } },
    select: { id: true, email: true, role: true, status: true },
  });
  const byEmail = new Map(existing.map((u) => [u.email, u]));

  const created: { email: string; name: string; password: string; riders: string[] }[] = [];
  const linkedExisting: { email: string; riders: string[] }[] = [];
  // The address already backs a non-parent login (a student's own, staff).
  const emailTaken: { email: string; riders: string[]; role: string }[] = [];

  for (const [email, kids] of families) {
    const names = kids.map((k) => `${k.firstName} ${k.lastName}`);
    const u = byEmail.get(email);
    if (u && u.role !== "PARENT") {
      emailTaken.push({ email, riders: names, role: u.role });
      continue;
    }
    if (d.dryRun) {
      if (u) linkedExisting.push({ email, riders: names });
      else created.push({ email, name: "", password: "", riders: names });
      continue;
    }
    const first = kids[0];
    const pc = (first.parentalConsentJson ?? {}) as { parentName?: string; parentRelation?: string; parentPhone?: string };
    const rel = RELATIONS.has(String(pc.parentRelation)) ? String(pc.parentRelation) : first.fatherName ? "father" : first.motherName ? "mother" : "guardian";
    let parentId = u?.id;
    let password = "";
    if (!parentId) {
      password = crypto.randomBytes(9).toString("base64url");
      const name = (pc.parentName || first.fatherName || first.motherName || `Parent of ${first.firstName}`).trim();
      const user = await prisma.user.create({
        data: {
          emailVerifiedAt: new Date(), // taken from the family's own registration
          email,
          name,
          phone: pc.parentPhone ?? first.fatherPhone ?? first.motherPhone ?? null,
          role: "PARENT",
          centreId: null, // parents aren't centre-scoped; tenancy flows through the link
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
        },
      });
      parentId = user.id;
      await storeIssuedCredential(prisma, user.id, password, session.userId);
      created.push({ email, name, password, riders: names });
    } else {
      linkedExisting.push({ email, riders: names });
    }
    await prisma.parentLink.createMany({
      data: kids.map((k) => ({ parentUserId: parentId!, riderId: k.id, relationship: rel })),
      skipDuplicates: true,
    });
  }

  if (d.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      wouldCreate: created.length,
      wouldLinkExisting: linkedExisting.length,
      riders: riders.length - noEmail.length - emailTaken.reduce((n, t) => n + t.riders.length, 0),
      noEmail,
      emailTaken,
    });
  }

  await audit({
    userId: session.userId,
    action: "rider.parent_access_bulk",
    tableName: "rider",
    rowId: resolved.centreId,
    after: {
      created: created.length,
      linkedExisting: linkedExisting.length,
      noEmail: noEmail.length,
      emailTaken: emailTaken.length,
    },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true, created, linkedExisting, noEmail, emailTaken });
}
