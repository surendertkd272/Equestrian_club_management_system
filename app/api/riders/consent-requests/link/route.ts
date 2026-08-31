import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { audit } from "@/lib/audit";
import { issueShareableLink } from "@/lib/rider-consent-request";
import { hasBaseUrl } from "@/lib/absolute-url";

// A signing link to hand over by hand.
//
// The emailed flow reaches about 4% of this club's riders, because 96 in 100
// have no email address on file and no WhatsApp or SMS provider is configured.
// Staff DO have WhatsApp on their own phones and every rider has a mobile, so
// the shortest real path to a signature is a link a human pastes into a chat.
//
// Same token, expiry and hashing as the emailed one — only the courier differs.

const SENDER_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"]);

const schema = z.object({
  riderId: z.string().min(1),
  centreId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!SENDER_ROLES.has(session.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  if (!hasBaseUrl()) {
    return NextResponse.json(
      {
        error: "NO_BASE_URL",
        message: "No public site address is configured, so the link would be unusable.",
      },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
  }

  const resolved = await resolveWriteCentre(session, { centreId: parsed.data.centreId });
  if (resolved.error) return resolved.error;

  const result = await issueShareableLink({
    riderId: parsed.data.riderId,
    centreId: resolved.centreId,
    createdById: session.userId,
  });
  if (!result) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (result.alreadySigned) {
    return NextResponse.json({ ok: true, alreadySigned: true });
  }

  // A link handed out by hand is still a credential that sets consent for a
  // named child — who minted it and for whom should be answerable.
  await audit({
    userId: session.userId,
    action: "rider.consent_link_issued",
    tableName: "rider",
    rowId: parsed.data.riderId,
    after: { via: "manual_share" },
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, url: result.url });
}
