import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createCentreSchema } from "@/lib/schemas/centre";
import { bootstrapCentreCatalog } from "@/lib/centre-bootstrap";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { getOrgIdForSession } from "@/lib/features-gate";

// POST /api/centres — create a new club. HQ-only.
// Auto-bootstraps the centre's catalog (fee plans, progress levels, skill tree,
// scoring templates) so it's immediately usable; staff/batches/horses are added
// via the existing admin pages.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createCentreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Surface slug collisions as a friendly 409 (rather than a raw Prisma error).
  const dupe = await prisma.centre.findUnique({ where: { slug: d.slug } });
  if (dupe) return NextResponse.json({ error: "SLUG_TAKEN" }, { status: 409 });

  // Bind the new centre to the CALLER's org (not an arbitrary findFirst, which
  // attached every tenant's new centre to whichever org sorted first).
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORGANISATION" }, { status: 500 });

  const centre = await prisma.centre.create({
    data: {
      orgId,
      slug: d.slug,
      name: d.name,
      address: d.address || null,
      gstNo: d.gstNo || null,
    },
  });

  // Catalog data so the new club is usable immediately.
  await bootstrapCentreCatalog(centre.id);

  await audit({
    userId: session.userId,
    action: "centre.create",
    tableName: "centre",
    rowId: centre.id,
    after: { slug: centre.slug, name: centre.name, address: centre.address },
  });

  return NextResponse.json({ ok: true, id: centre.id, slug: centre.slug });
}
