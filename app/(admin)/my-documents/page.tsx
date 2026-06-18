import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { startOfTodayForCentre } from "@/lib/centre-tz";
import { pendingItems, parseWaived } from "@/lib/onboarding-items";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { MyDocumentsForm } from "./form";

export const dynamic = "force-dynamic";

export default async function MyDocumentsPage() {
  const session = (await getSession())!;
  const ob = await prisma.employeeOnboarding.findFirst({
    where: { createdUserId: session.userId, status: "approved" },
  });

  if (!ob) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">My Documents</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            You have no pending onboarding documents.
          </CardContent>
        </Card>
      </div>
    );
  }

  const waived = parseWaived(ob.waivedItemsJson);
  const pending = pendingItems(ob as unknown as Record<string, unknown>, waived);
  const todayStart = await startOfTodayForCentre(session.centreId);
  const overdue = ob.documentsDueAt ? ob.documentsDueAt < todayStart : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Documents</h1>
        <p className="text-sm text-muted-foreground">
          Complete the documents and details below to finish your registration.
        </p>
      </div>

      {pending.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm">
            <span className="font-medium text-emerald-600">✓ All complete.</span> Thank you — nothing is pending.
          </CardContent>
        </Card>
      ) : (
        <>
          <div
            className={`rounded-md border p-3 text-sm ${
              overdue ? "border-rose-300 bg-rose-50 text-rose-800" : "border-amber-300 bg-amber-50 text-amber-800"
            }`}
          >
            {overdue ? (
              <>
                <strong>Overdue.</strong> Your {pending.length} pending item{pending.length === 1 ? "" : "s"} were due{" "}
                {ob.documentsDueAt ? formatDate(ob.documentsDueAt) : ""}. Please complete them as soon as possible — your
                club has been notified.
              </>
            ) : (
              <>
                You have <strong>{pending.length} pending item{pending.length === 1 ? "" : "s"}</strong>
                {ob.documentsDueAt ? <> — due by <strong>{formatDate(ob.documentsDueAt)}</strong></> : ""}.
              </>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pending items</CardTitle>
            </CardHeader>
            <CardContent>
              <MyDocumentsForm pending={pending} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
