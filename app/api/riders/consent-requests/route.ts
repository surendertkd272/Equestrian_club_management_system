import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { audit } from "@/lib/audit";
import { issueConsentRequests } from "@/lib/rider-consent-request";
import { hasBaseUrl } from "@/lib/absolute-url";

// Ask riders who have no signature on file to sign the indemnity + NOC.
//
// GET  — who is outstanding at this centre, and who can't be emailed.
// POST — issue and send the links.
//
// SUPER_ADMIN / ADMIN / CENTRE_MANAGER, matching who may verify the result.

const SENDER_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"]);

const schema = z.object({
  centreId: z.string().optional(),
  /** Omit to mean "everyone at this centre without a signature". */
  riderIds: z.array(z.string()).max(1000).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!SENDER_ROLES.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const url = new URL(req.url);
  const resolved = await resolveWriteCentre(session, {
    centreId: url.searchParams.get("centreId") ?? undefined,
  });
  if (resolved.error) return resolved.error;

  const riders = await prisma.rider.findMany({
    where: {
      centreId: resolved.centreId,
      indemnitySignedAt: null,
      // A withdrawn or rejected rider is not going to be asked to sign
      // anything — chasing them would be noise for the club and confusing
      // for the family.
      status: { notIn: ["withdrawn", "rejected", "cancelled"] },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      mobile: true,
      fatherPhone: true,
      motherPhone: true,
      // Feeds consentRecipient's parent-email fallback and consentPhone.
      parentalConsentJson: true,
      parentLinks: { select: { parent: { select: { email: true } } } },
      consentRequests: {
        where: { signedAt: null, expiresAt: { gt: new Date() } },
        select: { sentAt: true },
        orderBy: { sentAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ firstName: "asc" }],
  });

  const { consentRecipient } = await import("@/lib/rider-consent-request");
  return NextResponse.json({
    ok: true,
    canSend: hasBaseUrl(),
    rows: riders.map((r) => ({
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      email: consentRecipient(r),
      pendingSince: r.consentRequests[0]?.sentAt ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!SENDER_ROLES.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  // Fail before sending anything rather than emailing a roomful of parents a
  // link with no origin on it.
  if (!hasBaseUrl()) {
    return NextResponse.json(
      {
        error: "NO_BASE_URL",
        message:
          "No public site address is configured, so the signing link would arrive broken. Set NEXT_PUBLIC_APP_URL first.",
      },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const resolved = await resolveWriteCentre(session, { centreId: d.centreId });
  if (resolved.error) return resolved.error;

  const centre = await prisma.centre.findUnique({
    where: { id: resolved.centreId },
    select: { name: true },
  });

  const targets = d.riderIds?.length
    ? d.riderIds
    : (
        await prisma.rider.findMany({
          where: {
            centreId: resolved.centreId,
            indemnitySignedAt: null,
            status: { notIn: ["withdrawn", "rejected", "cancelled"] },
          },
          select: { id: true },
        })
      ).map((r) => r.id);

  const result = await issueConsentRequests({
    riderIds: targets,
    centreId: resolved.centreId,
    centreName: centre?.name ?? "the centre",
    createdById: session.userId,
  });

  await audit({
    userId: session.userId,
    action: "rider.consent_requests_sent",
    tableName: "rider",
    rowId: resolved.centreId,
    after: {
      requested: result.requested,
      noEmail: result.skippedNoEmail.length,
      alreadySigned: result.skippedAlreadySigned,
      alreadyPending: result.skippedAlreadyPending,
      failed: result.failed.length,
    },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, ...result });
}
