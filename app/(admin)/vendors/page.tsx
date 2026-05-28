// Vendor contact-database. SUPER_ADMIN + ADMIN see this; others don't.
// Sprint 3.6 categories: vet, farrier, horse ambulance, truck, feed,
// equipment_gear, other. Vet + Farrier rows carry extra registration
// info in categorySpecificJson — rendered by CategorySpecificDisplay
// at the bottom of this file.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { vendorScopeWhere } from "@/lib/vendor-scope";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, Mail } from "lucide-react";
import { VENDOR_CATEGORY_LABEL } from "@/lib/schemas/vendor";
import { NewVendorForm } from "./form";
import { DeactivateButton } from "@/components/ui/deactivate-button";

export const dynamic = "force-dynamic";

export default async function VendorsPage({ searchParams }: { searchParams: { category?: string } }) {
  const session = (await getSession())!;
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/dashboard");

  const centreId = scopeCentre(session);
  // Own-centre vendors + national (all-India) vendors in the same org.
  const scopeWhere = await vendorScopeWhere(session);
  const where: any = { ...scopeWhere, active: true };
  if (searchParams.category) where.category = searchParams.category;

  const [vendors, centres] = await Promise.all([
    prisma.vendor.findMany({
      where,
      include: { centre: { select: { name: true, slug: true } } },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.centre.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Group by category for the contact-book layout.
  const grouped = new Map<string, typeof vendors>();
  for (const v of vendors) {
    if (!grouped.has(v.category)) grouped.set(v.category, []);
    grouped.get(v.category)!.push(v);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Vendor contacts</h1>
        <p className="text-sm text-muted-foreground">
          Vet doctors, farriers, horse ambulance, truck, feed and tack suppliers.
          Tap a phone number to call or email to compose. {vendors.length} active.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add vendor</CardTitle>
          <CardDescription>Adds to {centreId ? "the selected centre" : "the centre you pick below"}.</CardDescription>
        </CardHeader>
        <CardContent>
          <NewVendorForm centres={centres} pinnedCentreId={centreId} />
        </CardContent>
      </Card>

      {grouped.size === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No vendors yet for this filter. Add one above.
          </CardContent>
        </Card>
      ) : (
        Array.from(grouped.entries()).map(([cat, items]) => (
          <Card key={cat}>
            <CardHeader>
              <CardTitle>
                {VENDOR_CATEGORY_LABEL[cat as keyof typeof VENDOR_CATEGORY_LABEL] ?? cat}{" "}
                <Badge variant="outline" className="ml-2">{items.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {items.map((v) => (
                  <li key={v.id} className="rounded-md border bg-card p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <span className="font-semibold">{v.name}</span>
                        {v.deliveryScope === "national" && (
                          <Badge variant="success" className="ml-2 text-[10px]">All-India</Badge>
                        )}
                        {v.contactName && <span className="ml-2 text-xs text-muted-foreground">via {v.contactName}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {v.deliveryScope === "national" ? `All clubs · added by ${v.centre?.name}` : v.centre?.name}
                        </span>
                        <DeactivateButton apiPath={`/api/vendors/${v.id}`} itemName={v.name} />
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-3 text-xs">
                      {v.phone && (
                        <a href={`tel:${v.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Phone className="h-3 w-3" /> {v.phone}
                        </a>
                      )}
                      {v.email && (
                        <a href={`mailto:${v.email}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Mail className="h-3 w-3" /> {v.email}
                        </a>
                      )}
                      {v.gstin && <span className="text-muted-foreground">GSTIN: <span className="font-mono">{v.gstin}</span></span>}
                    </div>
                    <CategorySpecificDisplay vendor={v} />
                    {v.address && <div className="mt-1 text-xs text-muted-foreground">{v.address}</div>}
                    {v.notes && <div className="mt-1 text-xs italic text-muted-foreground">{v.notes}</div>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

// Render the per-category extras (Vet Doctor / Farrier registration
// fields) on each vendor row. categorySpecificJson is now a native Json
// column (Prisma returns the parsed object directly — no JSON.parse here).
function CategorySpecificDisplay({
  vendor,
}: {
  vendor: { category: string; categorySpecificJson: unknown };
}) {
  if (
    !vendor.categorySpecificJson ||
    typeof vendor.categorySpecificJson !== "object" ||
    Array.isArray(vendor.categorySpecificJson)
  ) {
    return null;
  }
  const data = vendor.categorySpecificJson as Record<string, unknown>;
  const cells: string[] = [];
  if (vendor.category === "vet") {
    if (data.vciNumber) cells.push(`VCI ${data.vciNumber}`);
    if (data.qualification) cells.push(String(data.qualification));
    if (data.specialty) cells.push(`Spec: ${String(data.specialty).replaceAll("_", " ")}`);
    if (data.yearsPractice) cells.push(`${data.yearsPractice} yrs`);
    if (data.emergencyAvailable) cells.push("24×7 emergency");
    if (data.clinicAffiliation) cells.push(String(data.clinicAffiliation));
  } else if (vendor.category === "farrier") {
    if (data.yearsExperience) cells.push(`${data.yearsExperience} yrs exp`);
    if (Array.isArray(data.specialisations) && data.specialisations.length > 0) {
      cells.push(`Does: ${data.specialisations.map((s: string) => s.replaceAll("_", " ")).join(", ")}`);
    }
    if (Array.isArray(data.availableDays) && data.availableDays.length > 0) {
      cells.push(`Available: ${data.availableDays.join("/")}`);
    }
    if (data.carriesForge) cells.push("Carries forge");
    if (data.hourlyRate) cells.push(`₹${Number(data.hourlyRate).toLocaleString("en-IN")}/hr`);
  }
  if (cells.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {cells.map((c, i) => (
        <span key={i}>{c}</span>
      ))}
    </div>
  );
}
