import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewRequisitionForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewRequisitionPage() {
  const session = (await getSession())!;
  if (!can(session.role, "requisition.submit")) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>New requisition</CardTitle>
          <CardDescription>
            List what you need to purchase. It'll go to your centre manager for approval, then to
            the accountant for sign-off before you go ahead and buy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewRequisitionForm />
        </CardContent>
      </Card>
    </div>
  );
}
