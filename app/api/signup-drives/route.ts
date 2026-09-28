import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { audit } from "@/lib/audit";
import { absoluteUrl, hasBaseUrl } from "@/lib/absolute-url";
import { createDriveToken, DRIVE_MAX_DAYS } from "@/lib/signup-drive";

// POST /api/signup-drives — issue a sign-up drive link (see lib/signup-drive.ts).
// Same people who hand out the registration links.
const ROLES = new Set(["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"]);
const schema = z.object({
  centreId: z.string().optional(),
  school: z.string().trim().max(150).optional(),
  days: z.coerce.number().int().min(1).max(DRIVE_MAX_DAYS).default(3),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!ROLES.has(session.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  if (!hasBaseUrl()) {
    return NextResponse.json(
      { error: "NO_BASE_URL", message: "No public site address is configured (NEXT_PUBLIC_APP_URL), so the link would be broken." },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", message: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const resolved = await resolveWriteCentre(session, body ?? {});
  if (resolved.error) return resolved.error;
  const centre = await prisma.centre.findUnique({ where: { id: resolved.centreId }, select: { slug: true } });
  if (!centre) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const { token, driveId, expiresAt } = await createDriveToken({
    centreId: resolved.centreId,
    school: parsed.data.school,
    days: parsed.data.days,
  });
  await audit({
    userId: session.userId,
    action: "signup_drive.created",
    tableName: "centre",
    rowId: resolved.centreId,
    after: { driveId, school: parsed.data.school || null, expiresAt },
  });
  return NextResponse.json({
    ok: true,
    url: absoluteUrl(`/onboarding?centre=${encodeURIComponent(centre.slug)}&drive=${token}`),
    expiresAt,
  });
}
