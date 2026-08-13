import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Owner-portal 404, inside the protected shell so the platform nav survives.
// Three owner pages call notFound() — a tenant looked up by id that has since
// been offboarded, mainly — and the global 404 would have thrown the operator
// out to the tenant-facing sign-in page, which is the wrong place entirely.
export default function OwnerNotFound() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardHeader>
          <CardTitle>Not found</CardTitle>
          <CardDescription>
            That tenant or record no longer exists, or the link is out of date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/owner/tenants">All tenants</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/owner">Platform dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
