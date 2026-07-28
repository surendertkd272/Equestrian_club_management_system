import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewRequisitionForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewRequisitionPage() {
  const session = await requireSession();
  if (!can(session.role, "requisition.submit")) redirect("/dashboard");

  // SUPER_ADMIN needs a centre picker — their session has no centreId pin,
  // and the API rejects requisitions without one. Centre-scoped roles always
  // see their own centre so the picker is hidden.
  const isHQ = session.role === "SUPER_ADMIN" && !session.centreId;
  const centres = isHQ
    ? await prisma.centre.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>New Requisition</CardTitle>
          <CardDescription>
            List what you need to purchase. It'll go to your centre manager for approval, then to
            the accountant for sign-off before you go ahead and buy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewRequisitionForm centres={centres} />
        </CardContent>
      </Card>
    </div>
  );
}
