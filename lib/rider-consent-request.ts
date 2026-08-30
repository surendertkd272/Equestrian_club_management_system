import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail, renderEmail, isValidEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/absolute-url";

// Collecting indemnity + injury NOC from riders who never saw the public
// registration form.
//
// Bulk import and staff-created riders skip that form entirely, so they have
// no signature. A club importing 90 riders ends up with 90 people mounting
// horses against no consent at all — and nobody notices, because the profile
// simply shows a blank rather than an alarm.
//
// This issues a one-per-rider tokenised link to the same VERSIONED agreement
// text the public form uses, so a signature collected this way is the same
// legal artefact as one collected at registration.

/** Long enough that guessing is hopeless; URL-safe so it survives WhatsApp. */
const TOKEN_BYTES = 32;

/**
 * How long a link stays usable.
 *
 * Long, deliberately. The recipient is a parent who may not check email daily,
 * and an expired link produces exactly the outcome this feature exists to
 * prevent: a rider still unsigned, and now also annoyed. Reissuing is cheap
 * if it does lapse.
 */
const TTL_DAYS = 30;

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Who should receive the request for this rider.
 *
 * Prefers the rider's own address, falls back to a parent's. A minor often has
 * no email of their own, and the person who must sign for them is the parent
 * anyway — sending to a blank address is the one outcome that helps nobody.
 */
export function consentRecipient(rider: {
  email?: string | null;
  fatherPhone?: string | null;
  parentLinks?: { parent: { email: string | null } }[];
}): string | null {
  if (isValidEmail(rider.email)) return rider.email!.trim();
  for (const link of rider.parentLinks ?? []) {
    if (isValidEmail(link.parent.email)) return link.parent.email!.trim();
  }
  return null;
}

export type IssueResult = {
  requested: number;
  skippedNoEmail: { id: string; name: string }[];
  skippedAlreadySigned: number;
  skippedAlreadyPending: number;
  failed: { id: string; reason: string }[];
};

/**
 * Issue (and email) consent requests for a set of riders.
 *
 * Skips riders who already signed and riders with an outstanding unexpired
 * request — re-sending to someone who signed last week is how a club teaches
 * its parents to ignore these.
 */
export async function issueConsentRequests(opts: {
  riderIds: string[];
  centreId: string;
  centreName: string;
  createdById: string | null;
}): Promise<IssueResult> {
  const result: IssueResult = {
    requested: 0,
    skippedNoEmail: [],
    skippedAlreadySigned: 0,
    skippedAlreadyPending: 0,
    failed: [],
  };
  if (opts.riderIds.length === 0) return result;

  const riders = await prisma.rider.findMany({
    where: {
      id: { in: opts.riderIds },
      // Centre-scoped regardless of the ids handed in — the fence lives on the
      // query, not on the caller remembering to filter.
      centreId: opts.centreId,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      indemnitySignedAt: true,
      parentLinks: { select: { parent: { select: { email: true } } } },
      consentRequests: {
        where: { signedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      },
    },
  });

  const now = new Date();
  for (const rider of riders) {
    const name = `${rider.firstName} ${rider.lastName}`;
    if (rider.indemnitySignedAt) {
      result.skippedAlreadySigned++;
      continue;
    }
    if (rider.consentRequests.length > 0) {
      result.skippedAlreadyPending++;
      continue;
    }
    const to = consentRecipient(rider);
    if (!to) {
      // Not a failure — a real and common state (bulk sheets often omit the
      // email). Named, so the club can chase these on paper instead.
      result.skippedNoEmail.push({ id: rider.id, name });
      continue;
    }

    const raw = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    try {
      await prisma.riderConsentRequest.create({
        data: {
          riderId: rider.id,
          centreId: opts.centreId,
          email: to,
          tokenHash: hashToken(raw),
          expiresAt: new Date(now.getTime() + TTL_DAYS * 86400_000),
          createdById: opts.createdById,
        },
      });
      // Absolute, always. A relative link in an email is dead on arrival —
      // this bit us before on the shareable registration links.
      const url = absoluteUrl(`/consent/${raw}`);
      await sendEmail({
        to,
        subject: `Action needed: sign the riding indemnity for ${name}`,
        html: renderEmail({
          heading: "Please sign the riding indemnity",
          body: `<p>${escapeHtml(name)} is registered to ride at <strong>${escapeHtml(
            opts.centreName,
          )}</strong>.</p>
<p>Before their next session we need the riding indemnity and the No-Objection
Consent for injuries signed. It takes about a minute.</p>
<p><a href="${url}">Open the form and sign</a></p>
<p>This link is personal to ${escapeHtml(name)} — please don't forward it. It
expires in ${TTL_DAYS} days.</p>`,
        }),
      });
      result.requested++;
    } catch (e) {
      result.failed.push({ id: rider.id, reason: e instanceof Error ? e.message : "send failed" });
    }
  }
  return result;
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Look up a live request by its raw token. Null if unknown, used, or expired. */
export async function findLiveRequest(rawToken: string) {
  if (!rawToken || rawToken.length < 20) return null;
  const req = await prisma.riderConsentRequest.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: {
      rider: {
        select: { id: true, firstName: true, lastName: true, dob: true, indemnitySignedAt: true },
      },
      centre: { select: { id: true, name: true, orgId: true } },
    },
  });
  if (!req) return null;
  if (req.signedAt) return { ...req, state: "already_signed" as const };
  if (req.expiresAt.getTime() < Date.now()) return { ...req, state: "expired" as const };
  return { ...req, state: "live" as const };
}

export { hashToken };
