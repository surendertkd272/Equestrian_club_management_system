import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewAssetForm } from "./form";

export default async function NewAssetPage() {
  const session = (await getSession())!;
  if (!can(session.role, "asset.manage")) redirect("/tack");

  // SUPER_ADMIN doesn't have a centreId — surface a picker.
  const centres =
    session.role === "SUPER_ADMIN"
      ? await prisma.centre.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [];

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Add asset</CardTitle>
          <CardDescription>
            A unique QR code is generated automatically (e.g. <code>EW-TACK-A7K3F2</code>) — print the sticker from the
            asset's detail page and attach it to the physical item.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewAssetForm centres={centres} isSuperAdmin={session.role === "SUPER_ADMIN"} />
        </CardContent>
      </Card>
    </div>
  );
}
