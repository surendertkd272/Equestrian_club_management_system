import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Admin-shell 404. Segment-level not-found renders INSIDE the admin layout, so
// a missing record keeps the sidebar and top bar — someone who opened a stale
// link to a deleted rider stays oriented and one click from where they were,
// instead of being dropped on a bare page outside the app.
export default function AdminNotFound() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardHeader>
          <CardTitle>That record isn&apos;t here</CardTitle>
          <CardDescription>
            It may have been deleted, moved to another centre, or the link may be out of date.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            If you reached this from a saved link or a message, the item it pointed at no longer
            exists. Records removed to the bin can often still be restored.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/bin">Check the bin</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
