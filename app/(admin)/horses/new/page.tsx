import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewHorseForm } from "./form";

export default async function NewHorsePage() {
  const session = await requireSession();
  if (!can(session.role, "horse.manage")) redirect("/horses");
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Add Horse</CardTitle>
          <CardDescription>
            Onboard a new horse to the centre roster. Status defaults to <code>active</code>. Workload tracking begins
            from the first allocation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewHorseForm />
        </CardContent>
      </Card>
    </div>
  );
}
