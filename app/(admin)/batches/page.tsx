import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { NewBatchForm } from "./new-form";

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);
  const where = centreWhere(centreId);

  const batches = await prisma.batch.findMany({
    where,
    orderBy: { startTime: "asc" },
    include: { _count: { select: { riders: true, attendances: true } } },
  });

  const coaches =
    session.role === "SUPER_ADMIN"
      ? []
      : await prisma.user.findMany({
          where: { centreId: session.centreId!, role: "COACH", status: "active" },
          select: { id: true, name: true },
        });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Batches</h1>
          <p className="text-sm text-muted-foreground">§4.2 / §4.8 · Recurring class slots assigned to a coach.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>All batches</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2">Name</th>
                    <th className="pb-2">Days</th>
                    <th className="pb-2">Time</th>
                    <th className="pb-2">Level</th>
                    <th className="pb-2">Riders</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="border-t">
                      <td className="py-2 font-medium">{b.name}</td>
                      <td className="py-2">{b.dayOfWeek}</td>
                      <td className="py-2">
                        {b.startTime}–{b.endTime}
                      </td>
                      <td className="py-2">{b.level ?? "—"}</td>
                      <td className="py-2">{b._count.riders}</td>
                      <td className="py-2 text-right">
                        <Link className="text-xs text-primary underline" href={`/attendance?batch=${b.id}`}>
                          Mark attendance →
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {batches.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        No batches yet. Use the form on the right to create one.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>New batch</CardTitle>
            </CardHeader>
            <CardContent>
              <NewBatchForm coaches={coaches} disabled={session.role === "SUPER_ADMIN" && !session.centreId} />
              {session.role === "SUPER_ADMIN" && !session.centreId && (
                <p className="mt-3 text-xs text-muted-foreground">
                  As Super Admin you don't have a default centre. Switch to a centre context (TBD) before creating batches.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
