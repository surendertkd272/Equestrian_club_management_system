import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { centreWhere, scopeCentre } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { parseClasses } from "@/lib/schemas/competition";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "outline"> = {
  draft: "outline",
  open_for_entries: "warning",
  live: "success",
  completed: "outline",
  cancelled: "destructive",
};

export default async function CompetitionsPage() {
  const session = (await getSession())!;
  const centreId = scopeCentre(session);

  const competitions = await prisma.competition.findMany({
    where: centreWhere(centreId),
    orderBy: { startDate: "desc" },
    include: { _count: { select: { entries: true } } },
  });

  const canManage = can(session.role, "competition.manage");

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Competitions</h1>
          <p className="text-sm text-muted-foreground">
            {competitions.length} on the calendar
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/competitions/new">
              <Plus className="h-4 w-4" /> New competition
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All competitions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Scope</th>
                  <th className="pb-2">Dates</th>
                  <th className="pb-2">Venue</th>
                  <th className="pb-2">Classes</th>
                  <th className="pb-2">Entries</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {competitions.map((c) => {
                  const classes = parseClasses(c.classesJson);
                  return (
                    <tr key={c.id} className="border-t hover:bg-muted/40">
                      <td className="py-2">
                        <Link href={`/competitions/${c.id}`} className="font-medium hover:underline">
                          {c.name}
                        </Link>
                        <div className="text-[10px] font-mono text-muted-foreground">{c.slug}</div>
                      </td>
                      <td className="py-2">
                        <Badge variant="outline">{c.scope.replaceAll("_", " ")}</Badge>
                      </td>
                      <td className="py-2 text-xs">
                        {formatDate(c.startDate)}
                        {c.startDate.getTime() !== c.endDate.getTime() && (
                          <>
                            <br />— {formatDate(c.endDate)}
                          </>
                        )}
                      </td>
                      <td className="py-2">{c.venue ?? "—"}</td>
                      <td className="py-2">{classes.length}</td>
                      <td className="py-2">{c._count.entries}</td>
                      <td className="py-2">
                        <Badge variant={STATUS_VARIANT[c.status] ?? "outline"}>{c.status.replaceAll("_", " ")}</Badge>
                      </td>
                      <td className="py-2 space-x-2 text-right">
                        <Link href={`/competitions/${c.id}`} className="text-xs text-primary underline">
                          Manage
                        </Link>
                        {(c.status === "live" || c.status === "completed") && (
                          <Link
                            href={`/scoreboard/${c.slug}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 text-xs text-primary underline"
                          >
                            Live <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {competitions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      No competitions yet.
                      {canManage && (
                        <>
                          {" "}
                          <Link href="/competitions/new" className="text-primary underline">
                            Create the first one
                          </Link>
                          .
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
