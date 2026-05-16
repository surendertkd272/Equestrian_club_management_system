import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewMedicineForm } from "./form";

export default async function NewMedicinePage() {
  const session = (await getSession())!;
  if (!can(session.role, "medicine.manage")) redirect("/medicines");

  // SUPER_ADMIN can add medicines to any centre; everyone else's session is
  // pinned to their own centre and we don't show the picker.
  const centres =
    session.role === "SUPER_ADMIN"
      ? await prisma.centre.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [];

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Add medicine batch</CardTitle>
          <CardDescription>
            One row per batch (so each lot has its own expiry & quantity). Reorder threshold defaults to 5 — when stock
            drops to or below this, the dashboard flags it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewMedicineForm centres={centres} isSuperAdmin={session.role === "SUPER_ADMIN"} />
        </CardContent>
      </Card>
    </div>
  );
}
