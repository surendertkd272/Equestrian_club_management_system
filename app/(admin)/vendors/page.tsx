// Vendor contact-database. SUPER_ADMIN + ADMIN see this; others don't.
// Categories: vet, farrier, horse ambulance, truck, feed, tack, medical
// supply, other. Tap-to-call + tap-to-email shortcuts.

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre, centreWhere } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, Mail } from "lucide-react";
import { VENDOR_CATEGORY_LABEL } from "@/lib/schemas/vendor";
import { NewVendorForm } from "./form";

export const dynamic = "force-dynamic";

export default async function VendorsPage({ searchParams }: { searchParams: { category?: string } }) {
  const session = (await getSession())!;
  if (session.role !== "SUPER_ADMIN" && session.role !== "ADMIN") redirect("/dashboard");

  const centreId = scopeCentre(session);
  const where: any = { ...centreWhere(centreId), active: true };
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
                        {v.contactName && <span className="ml-2 text-xs text-muted-foreground">via {v.contactName}</span>}
                      </div>
                      <span className="text-xs text-muted-foreground">{v.centre?.name}</span>
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
