import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Shared by every school page. An account with no centre has nothing to show,
// and each page rendering its own variant of this was three chances to get the
// wording wrong.
export function NoCentreCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No club assigned</CardTitle>
        <CardDescription>
          Your account isn&apos;t linked to a club yet. Ask the centre admin to assign you to a
          centre, and this portal will fill in.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
