// CSV export of a centre's equipment inventory in the exact column shape
// of the client's reference PDF (S.NO · Name · Unused / New · In-Use ·
// For Repair · Damaged · Total · Comments · New Required · Owner).
//
// Rows are grouped by category headers so the output reads like the PDF.
// SUPER_ADMIN / ADMIN can pass ?centreId= to export any centre; centre-
// scoped users get their own centre only.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Quote if it contains commas, quotes, or newlines; double up internal quotes.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const url = new URL(req.url);
  const requested = url.searchParams.get("centreId");
  const isHQ = session.role === "SUPER_ADMIN" || session.role === "ADMIN";
  const centreId = requested && isHQ ? requested : scopeCentre(session);
  if (!centreId) return NextResponse.json({ error: "NO_CENTRE_CONTEXT" }, { status: 400 });

  const [centre, catalog, stocks] = await Promise.all([
    prisma.centre.findUnique({ where: { id: centreId }, select: { name: true, slug: true } }),
    prisma.equipmentCatalog.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.equipmentStock.findMany({ where: { centreId } }),
  ]);

  if (!centre) return NextResponse.json({ error: "CENTRE_NOT_FOUND" }, { status: 404 });

  const stockByCatalog = new Map(stocks.map((s) => [s.catalogId, s]));

  const lines: string[] = [];
  // Header rows mimicking the PDF — a metadata block followed by the
  // tabular header. Excel ignores the metadata while opening, but a
  // human reviewing the CSV gets context.
  lines.push(`Equiwings inventory export`);
  lines.push(`Centre,${csvCell(centre.name)}`);
  lines.push(`Exported,${new Date().toISOString().split("T")[0]}`);
  lines.push("");
  lines.push("S.NO,Category,Item,Unit,Unused/New,In-Use,For Repair,Damaged,Total,New Required,Owner,Comments,Reorder at");

  let rowIdx = 0;
  let currentCategory = "";
  for (const item of catalog) {
    if (item.category !== currentCategory) {
      currentCategory = item.category;
      lines.push(""); // blank line between categories
    }
    rowIdx++;
    const s = stockByCatalog.get(item.id);
    const unused = s?.qtyUnused ?? 0;
    const inUse = s?.qtyInUse ?? 0;
    const forRepair = s?.qtyForRepair ?? 0;
    const damaged = s?.qtyDamaged ?? 0;
    const total = unused + inUse + forRepair + damaged;
    const cells = [
      rowIdx,
      item.category.toUpperCase(),
      item.name,
      item.unit,
      unused,
      inUse,
      forRepair,
      damaged,
      total,
      s?.newRequired ?? 0,
      s?.owner ?? "",
      s?.notes ?? "",
      s?.threshold ?? item.defaultThreshold,
    ];
    lines.push(cells.map(csvCell).join(","));
  }

  const csv = lines.join("\n") + "\n";
  const fileName = `equiwings-inventory-${centre.slug}-${new Date().toISOString().split("T")[0]}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
