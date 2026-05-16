import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function RidersImportPage() {
  const session = (await getSession())!;
  if (!["SUPER_ADMIN", "CENTRE_MANAGER"].includes(session.role)) {
    redirect("/riders");
  }
  const centreId = scopeCentre(session);

  // Examiners are surfaced as a dropdown so the import can optionally
  // schedule exams in the same shot (any row that has a `level` column
  // gets an exam with the chosen examiner).
  const examiners = await prisma.user.findMany({
    where: {
      ...(centreId ? { centreId } : {}),
      role: { in: ["EXAMINER", "JURY", "HEAD_COACH", "CENTRE_MANAGER", "SUPER_ADMIN"] as any },
      status: "active",
    },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/riders">
            <ChevronLeft className="h-4 w-4" /> Back to riders
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Import riders (CSV)</CardTitle>
          <CardDescription>
            Bulk-create rider profiles from a spreadsheet. Run a dry preview first to catch
            duplicates and bad rows before anything is written.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImportForm examiners={examiners} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Column reference</CardTitle>
          <CardDescription>
            Headers are case-insensitive; aliases shown in parentheses also work.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="space-y-1">
            <li>
              <code className="rounded bg-muted px-1">first_name</code> (firstname / fname / given_name) — required
            </li>
            <li>
              <code className="rounded bg-muted px-1">last_name</code> (lastname / surname) — required
            </li>
            <li>
              <code className="rounded bg-muted px-1">mobile</code> (phone / contact) — required, used for dedup
            </li>
            <li>
              <code className="rounded bg-muted px-1">email</code> — optional, used for dedup
            </li>
            <li>
              <code className="rounded bg-muted px-1">dob</code> (date_of_birth / birthday) — required, format <code>YYYY-MM-DD</code>
            </li>
            <li>
              <code className="rounded bg-muted px-1">gender</code> (sex) — optional, M / F / O
            </li>
            <li>
              <code className="rounded bg-muted px-1">school</code> — optional
            </li>
            <li>
              <code className="rounded bg-muted px-1">joining_date</code> — optional, format <code>YYYY-MM-DD</code>
            </li>
            <li>
              <code className="rounded bg-muted px-1">level</code> (exam_level) — optional integer. If present
              AND an examiner is selected, a scheduled exam is created for the rider at that level.
            </li>
          </ul>
          <details className="rounded-md border bg-muted/30 p-3 text-xs">
            <summary className="cursor-pointer font-medium">Example CSV</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre">
{`first_name,last_name,mobile,email,dob,gender,school,level
Riya,Sharma,9876543210,riya@example.in,2012-04-12,F,DPS Bangalore,1
Aarav,Patel,9876501234,aarav@example.in,2010-11-03,M,Bishop Cotton,2
`}
            </pre>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
