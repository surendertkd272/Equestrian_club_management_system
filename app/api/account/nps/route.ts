import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

const schema = z.object({
  score: z.coerce.number().int().min(0).max(10),
  comment: z.string().max(1000).optional().nullable(),
  context: z.string().max(80).optional().nullable(),
});

// POST /api/account/nps — record the signed-in user's NPS response.
// Idempotent on a per-90-day-bucket basis: a second response within
// 90 days overwrites the earlier one rather than spamming.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const me = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { orgId: true, centre: { select: { orgId: true } } },
  });
  const orgId = me?.orgId ?? me?.centre?.orgId ?? null;

  // 90-day dedup — replace the most recent response from this user.
  const recent = await prisma.npsResponse.findFirst({
    where: { userId: session.userId, createdAt: { gte: new Date(Date.now() - 90 * 86400000) } },
    select: { id: true },
  });

  let row;
  if (recent) {
    row = await prisma.npsResponse.update({
      where: { id: recent.id },
      data: {
        score: parsed.data.score,
        comment: parsed.data.comment ?? null,
        context: parsed.data.context ?? null,
      },
    });
  } else {
    row = await prisma.npsResponse.create({
      data: {
        userId: session.userId,
        orgId,
        score: parsed.data.score,
        comment: parsed.data.comment ?? null,
        context: parsed.data.context ?? null,
      },
    });
  }

  await audit({
    userId: session.userId,
    action: "nps.submitted",
    tableName: "npsResponse",
    rowId: row.id,
    after: { score: row.score },
  });

  return NextResponse.json({ ok: true });
}
