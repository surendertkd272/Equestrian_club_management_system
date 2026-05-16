import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOwnerSession } from "@/lib/owner-auth";
import { auditOwner } from "@/lib/owner-audit";
import { forbidIfMissingOwnerPerm } from "@/lib/owner-permissions";

const schema = z.object({
  legalName: z.string().min(1).max(200),
  gstin: z.string().max(20).optional().nullable(),
  hsnCode: z.string().max(10).optional().nullable(),
  panNo: z.string().max(15).optional().nullable(),
  addressLine1: z.string().max(200).optional().nullable(),
  addressLine2: z.string().max(200).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  state: z.string().max(80).optional().nullable(),
  pincode: z.string().max(10).optional().nullable(),
  country: z.string().max(40).optional(),
  billingEmail: z.string().email().optional().or(z.literal("")),
  supportEmail: z.string().email().optional().or(z.literal("")),
  invoicePrefix: z.string().min(1).max(10).optional(),
  defaultTaxBps: z.coerce.number().int().min(0).max(10000).optional(),
});

// GET — return current row (upsert with defaults if missing).
export async function GET() {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const cfg = await prisma.platformBillingConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  return NextResponse.json({ config: cfg });
}

// PATCH — edit. Restricted to OWNER_ADMIN + OWNER_BILLING; OWNER_EDITOR cannot
// touch billing identity (same scope as plan changes and custom-domain edits).
export async function PATCH(req: NextRequest) {
  const session = await getOwnerSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const block = forbidIfMissingOwnerPerm(session.role, "tenant.edit_billing");
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const before = await prisma.platformBillingConfig.findUnique({ where: { id: "default" } });
  const cfg = await prisma.platformBillingConfig.upsert({
    where: { id: "default" },
    create: { id: "default", ...d, updatedBy: session.ownerId },
    update: { ...d, updatedBy: session.ownerId },
  });

  await auditOwner({
    actorId: session.ownerId,
    action: "owner.platform_billing_updated",
    before,
    after: cfg,
  });

  return NextResponse.json({ ok: true, config: cfg });
}
