import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Global 404. Thirty pages call notFound() — a deleted rider, a stale
// WhatsApp link, a mistyped URL — and every one of them landed on Next's
// unstyled default: no branding, no explanation, and no way back except the
// browser's back button.
//
// Deliberately does NOT assume a session: this renders for signed-out visitors
// on a bad public link too, so it offers the sign-in page rather than a
// dashboard the visitor may have no right to.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>We couldn&apos;t find that page</CardTitle>
          <CardDescription>
            The link may be out of date, or the record may have been removed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            If you followed a link from a message or email, it may point at something that has
            since been deleted. Nothing is wrong with your account.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
