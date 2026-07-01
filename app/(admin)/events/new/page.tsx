import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewEventForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const session = (await getSession())!;
  if (!can(session.role, "event.manage")) redirect("/events");

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>New Event</CardTitle>
          <CardDescription>
            Set up a clinic, schooling day, parent day, fundraiser, or off-site external show.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewEventForm />
        </CardContent>
      </Card>
    </div>
  );
}
