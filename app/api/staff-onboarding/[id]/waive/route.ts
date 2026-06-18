// Admin / super-admin waives onboarding items that don't apply to a hire —
// either specific item keys or all currently-pending ones. Waived items stop
// counting as pending (employee banner, admin list, overdue sweep).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { audit } from "@/lib/audit";
import { ONBOARDING_ITEM_KEYS, parseWaived, pendingItems } from "@/lib/onboarding-items";

const schema = z.object({
  items: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const block = await blockIfReadOnly(session);
  if (block) return block;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const ob = await prisma.employeeOnboarding.findUnique({ where: { id: params.id } });
  if (!ob) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && ob.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const waived = new Set(parseWaived(ob.waivedItemsJson));
  if (parsed.data.all) {
    for (const it of pendingItems(ob as unknown as Record<string, unknown>, [...waived])) waived.add(it.key);
  } else {
    for (const k of parsed.data.items ?? []) if (ONBOARDING_ITEM_KEYS.includes(k)) waived.add(k);
  }

  await prisma.employeeOnboarding.update({
    where: { id: ob.id },
    data: { waivedItemsJson: [...waived] },
  });
  await audit({
    userId: session.userId,
    action: "staff_onboarding.waived",
    tableName: "employeeOnboarding",
    rowId: ob.id,
    after: { waived: [...waived] },
  });
  return NextResponse.json({ ok: true, waived: [...waived] });
}
