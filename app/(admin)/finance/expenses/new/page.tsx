import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { scopeCentre } from "@/lib/tenancy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewExpenseForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewExpensePage() {
  const session = (await getSession())!;
  if (!can(session.role, "expense.manage")) redirect("/finance");
  const centreId = scopeCentre(session);

  const [categories, vendors] = await Promise.all([
    prisma.expenseCategory.findMany({
      where: { active: true },
      orderBy: [{ group: "asc" }, { name: "asc" }],
    }),
    prisma.vendor.findMany({
      where: { ...(centreId ? { centreId } : {}), active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>New expense</CardTitle>
          <CardDescription>
            Books an outflow against the centre. Categories are HQ-curated; vendors are
            centre-scoped so each club tracks its own suppliers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewExpenseForm categories={categories} vendors={vendors} />
        </CardContent>
      </Card>
    </div>
  );
}
