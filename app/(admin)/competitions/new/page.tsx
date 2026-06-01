import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewCompetitionForm } from "./form";

export default async function NewCompetitionPage() {
  const session = (await getSession())!;
  if (!can(session.role, "competition.manage")) redirect("/competitions");
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>New competition</CardTitle>
          <CardDescription>
            Define the basics, scoring type, and the disciplines/events offered. You can add entries from the detail
            page once the competition is in draft.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewCompetitionForm />
        </CardContent>
      </Card>
    </div>
  );
}
