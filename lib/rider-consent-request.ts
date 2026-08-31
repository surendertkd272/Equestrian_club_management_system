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
  parentLinks?: { parent: { email: string | null } }[];
  parentalConsentJson?: unknown;
}): string | null {
  if (isValidEmail(rider.email)) return rider.email!.trim();
  for (const link of rider.parentLinks ?? []) {
    if (isValidEmail(link.parent.email)) return link.parent.email!.trim();
  }
  // The DPDPA parental-consent block captured at registration can carry a
  // parent's email, and this ignored it — so a rider whose parent DID give an
  // address was still counted as unreachable. On the live data only one rider
  // is recovered by this, but the bug was in the resolution order rather than
  // the data: for any club that collects parent emails properly it would have
  // silently excluded most of the roster.
  const pc = rider.parentalConsentJson as { parentEmail?: unknown } | null | undefined;
  if (pc && typeof pc.parentEmail === "string" && isValidEmail(pc.parentEmail)) {
    return pc.parentEmail.trim();
  }
  return null;
}

/**
 * A phone number to reach the rider's family on, for the cases email cannot
 * cover — which, on real data, is most of them.
 *
 * Prefers a parent's number over the rider's own: the signer for a minor is
 * the parent, and a child's handset is the wrong place to send a legal
 * agreement even when it is the number on file.
 */
export function consentPhone(rider: {
  mobile?: string | null;
  fatherPhone?: string | null;
  motherPhone?: string | null;
  parentalConsentJson?: unknown;
}): string | null {
  const pc = rider.parentalConsentJson as { parentPhone?: unknown } | null | undefined;
  if (pc && typeof pc.parentPhone === "string" && pc.parentPhone.trim()) return pc.parentPhone.trim();
  if (rider.fatherPhone?.trim()) return rider.fatherPhone.trim();
  if (rider.motherPhone?.trim()) return rider.motherPhone.trim();
  return rider.mobile?.trim() || null;
}

/**
 * Issue a link WITHOUT emailing it, for hand-delivery.
 *
 * On the live roster 96 riders in 100 have no email address, and neither
 * WhatsApp nor SMS has a provider configured — so an email-only feature
 * reaches about 4% of the people it is meant for. Staff do have WhatsApp on
 * their own phones and every rider has a mobile on file, so the shortest path
 * to consent is a link a human can paste into a chat.
 *
 * Same token, same expiry, same hashing as the emailed one. The only
 * difference is who carries it.
 */
export async function issueShareableLink(opts: {
  riderId: string;
  centreId: string;
  createdById: string | null;
}): Promise<{ url: string; alreadySigned?: boolean } | null> {
  const rider = await prisma.rider.findFirst({
    // Centre-fenced on the query, as everywhere else here.
    where: { id: opts.riderId, centreId: opts.centreId },
    select: { id: true, indemnitySignedAt: true },
  });
  if (!rider) return null;
  if (rider.indemnitySignedAt) return { url: "", alreadySigned: true };

  const raw = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  await prisma.riderConsentRequest.create({
    data: {
      riderId: rider.id,
      centreId: opts.centreId,
      // No address was used; record that plainly rather than inventing one.
      email: "",
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + TTL_DAYS * 86400_000),
      createdById: opts.createdById,
    },
  });
  return { url: absoluteUrl(`/consent/${raw}`) };
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
      // Needed by consentRecipient — without it the parent-email fallback
      // silently never fires.
      parentalConsentJson: true,
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
        select: { id: true, firstName: true, lastName: true, dob: true, indemnitySignedAt: true, status: true },
      },
      // timezone: the receipt states when they signed, and the server runs UTC.
      centre: { select: { id: true, name: true, orgId: true, timezone: true } },
    },
  });
  if (!req) return null;
  if (req.signedAt) return { ...req, state: "already_signed" as const };
  if (req.expiresAt.getTime() < Date.now()) return { ...req, state: "expired" as const };
  return { ...req, state: "live" as const };
}

export { hashToken };

/**
 * Email the signer their own copy of what they just agreed to.
 *
 * Without this the parent ticks two legal agreements, sees a green box, closes
 * the tab, and holds nothing. The registration form promises the signature is
 * recorded "as legal proof of consent" — proof only the club holds is a weak
 * version of that, and a copy in the parent's inbox is the first thing anyone
 * asks for after an incident.
 *
 * Contains the FULL agreement text rather than a link, so the record survives
 * the wording being revised later and does not depend on a URL still resolving
 * in three years.
 *
 * Never throws: a mail failure must not undo a signature that is already
 * recorded.
 */
export async function sendConsentReceipt(opts: {
  to: string;
  riderName: string;
  centreName: string;
  timeZone: string;
  signature: string;
  signerRelation: string;
  signedAt: Date;
  indemnityText: string;
  indemnityVersion: string;
  nocText: string;
  nocVersion: string;
}): Promise<void> {
  try {
    if (!isValidEmail(opts.to)) return;
    const when = opts.signedAt.toLocaleString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: opts.timeZone,
    });
    const relation =
      opts.signerRelation === "self" ? "the rider" : opts.signerRelation;

    await sendEmail({
      to: opts.to,
      subject: `Your signed indemnity for ${opts.riderName}`,
      html: renderEmail({
        centreName: opts.centreName,
        heading: "Your copy of the signed indemnity",
        body: `<p>Thank you — this is your record of the agreement signed for
<strong>${escapeHtml(opts.riderName)}</strong> at ${escapeHtml(opts.centreName)}.
Keep this email; you do not need to do anything else.</p>

<table style="width:100%;margin:16px 0;border-collapse:collapse;font-size:14px">
  <tr><td style="padding:8px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase">Signed by</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">${escapeHtml(opts.signature)} (${escapeHtml(relation)})</td></tr>
  <tr><td style="padding:8px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase">Signed on</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">${when}</td></tr>
  <tr><td style="padding:8px;background:#f9fafb;border:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-transform:uppercase">Rider</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">${escapeHtml(opts.riderName)}</td></tr>
</table>

<h3 style="font-size:15px;margin:20px 0 6px">Indemnity &amp; liability release <span style="font-weight:400;color:#6b7280">(${escapeHtml(opts.indemnityVersion)})</span></h3>
<p style="font-size:13px;line-height:1.6;color:#374151">${escapeHtml(opts.indemnityText)}</p>

<h3 style="font-size:15px;margin:20px 0 6px">No-Objection Consent for injuries <span style="font-weight:400;color:#6b7280">(${escapeHtml(opts.nocVersion)})</span></h3>
<p style="font-size:13px;line-height:1.6;color:#374151">${escapeHtml(opts.nocText)}</p>

<p style="margin-top:20px;font-size:13px;color:#6b7280">If you did not sign this, or anything above is wrong,
reply to this email or contact ${escapeHtml(opts.centreName)} straight away.</p>`,
      }),
      ref: { type: "rider.consent_receipt", payload: { riderName: opts.riderName } },
    });
  } catch (e) {
    // The signature is already recorded. Losing the receipt is a nuisance;
    // failing the request would lose the consent.
    console.error("[consent] receipt email failed", e);
  }
}
