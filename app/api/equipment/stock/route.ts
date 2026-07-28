import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentreForRoute, tenantWhere } from "@/lib/tenancy";
import { getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";

// GET — list every catalog item joined with the centre's current stock
// row (if any). Returns one row per catalog item so the inventory page can
// show items with qty=0 alongside items that exist. Cross-centre queries
// are SUPER_ADMIN-only via ?centreId=.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });

  const url = new URL(req.url);
  const requested = url.searchParams.get("centreId");
  const scoped = scopeCentreForRoute(session);
  if (scoped.error) return scoped.error;
  const centreId = requested && session.role === "SUPER_ADMIN" ? requested : scoped.centreId;
  if (!centreId) {
    return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });
  }

  // HQ targeting a specific centre via ?centreId=: that centre must live in
  // the caller's org. tenantWhere already yields 0 rows for a foreign centre,
  // but reject explicitly so we don't echo a cross-org centreId back as if
  // it were valid.
  if (requested && session.role === "SUPER_ADMIN") {
    const targetOrgId = await getOrgIdForCentre(centreId);
    if (targetOrgId !== orgId) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
    }
  }

  const [catalog, stocks] = await Promise.all([
    prisma.equipmentCatalog.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.equipmentStock.findMany({ where: tenantWhere(centreId, orgId) }),
  ]);
  const stockByCatalog = new Map(stocks.map((s) => [s.catalogId, s]));

  const items = catalog.map((c) => {
    const s = stockByCatalog.get(c.id);
    const threshold = s?.threshold ?? c.defaultThreshold;
    const qty = s?.qty ?? 0;
    return {
      catalogId: c.id,
      stockId: s?.id ?? null,
      category: c.category,
      name: c.name,
      code: c.code,
      unit: c.unit,
      qty,
      threshold,
      defaultThreshold: c.defaultThreshold,
      lowStock: qty < threshold,
      lastRestockedAt: s?.lastRestockedAt?.toISOString() ?? null,
      notes: s?.notes ?? null,
    };
  });

  return NextResponse.json({ centreId, items });
}
