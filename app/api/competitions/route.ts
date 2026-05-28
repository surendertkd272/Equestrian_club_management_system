import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { createCompetitionSchema } from "@/lib/schemas/competition";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const featureBlock = await blockIfFeatureOff(session, "competitions");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;
  if (!session.centreId && session.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "NO_CENTRE" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createCompetitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const centreId = session.centreId ?? (body?.centreId as string | undefined);
  if (!centreId) return NextResponse.json({ error: "centreId required" }, { status: 400 });

  if (new Date(d.endDate) < new Date(d.startDate)) {
    return NextResponse.json({ error: "INVALID_DATES", message: "endDate must be on/after startDate" }, { status: 400 });
  }

  // Slug must be unique globally (so the public URL is stable across centres).
  const slugTaken = await prisma.competition.findUnique({ where: { slug: d.slug } });
  if (slugTaken) {
    return NextResponse.json({ error: "SLUG_TAKEN", message: "That slug is already in use." }, { status: 409 });
  }

  const comp = await prisma.competition.create({
    data: {
      centreId,
      name: d.name,
      slug: d.slug,
      scope: d.scope,
      discipline: d.discipline,
      startDate: new Date(d.startDate),
      endDate: new Date(d.endDate),
      venue: d.venue || null,
      entryDeadline: d.entryDeadline ? new Date(d.entryDeadline) : null,
      // jsonb column — pass the array directly (post-migration in 81f142a).
      classesJson: d.classes,
      status: "draft",
    },
  });

  await audit({
    userId: session.userId,
    action: "create",
    tableName: "competition",
    rowId: comp.id,
    after: { name: comp.name, slug: comp.slug, classes: d.classes.length },
  });

  return NextResponse.json({ id: comp.id, slug: comp.slug });
}
