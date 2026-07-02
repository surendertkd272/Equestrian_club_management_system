import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getOrgIdForSession } from "@/lib/features-gate";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

// Public-facing contact details for the org (Help Center / portals). Editable by
// the two HQ roles only, always scoped to the caller's own org.
const schema = z.object({
  supportEmail: z.string().trim().email("Enter a valid email").or(z.literal("")).optional(),
  supportPhone: z.string().trim().max(40).optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORGANISATION" }, { status: 500 });

  // Empty string clears the field (falls back to the platform default on read).
  const data = {
    supportEmail: parsed.data.supportEmail === undefined ? undefined : parsed.data.supportEmail || null,
    supportPhone: parsed.data.supportPhone === undefined ? undefined : parsed.data.supportPhone || null,
  };

  const before = await prisma.organisation.findUnique({
    where: { id: orgId },
    select: { supportEmail: true, supportPhone: true },
  });
  const org = await prisma.organisation.update({
    where: { id: orgId },
    data,
    select: { supportEmail: true, supportPhone: true },
  });

  await audit({
    userId: session.userId,
    action: "settings.contact.update",
    tableName: "Organisation",
    rowId: orgId,
    before,
    after: org,
  });

  return NextResponse.json({ ok: true, ...org });
}
