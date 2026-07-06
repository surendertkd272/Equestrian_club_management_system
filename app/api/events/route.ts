import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { tenantWhere, scopeCentre } from "@/lib/tenancy";
import { createEventSchema } from "@/lib/schemas/event";
import { audit } from "@/lib/audit";
import { blockIfFeatureOff, getOrgIdForSession, getOrgIdForCentre } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// POST — create a new event (clinic, schooling, fundraiser, etc.). Status
// starts at draft. Slug, if supplied, must be globally unique because the
// public /events/<slug> page is keyed by it.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "event.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const featureBlock = await blockIfFeatureOff(session, "events");
  if (featureBlock) return featureBlock;
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });

  const centreId = scopeCentre(session) ?? (body?.centreId as string | undefined);
  if (!centreId) {
    return NextResponse.json(
      {
        error: "NO_CENTRE_SELECTED",
        message: "Pick a specific centre from the top-bar centre selector (not “All centres”), then try again.",
      },
      { status: 400 },
    );
  }

  // HQ can target any centre via body.centreId — confirm it's within their org
  // before writing, so an HQ admin can't create events under another org's centre.
  if ((await getOrgIdForCentre(centreId)) !== orgId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_ORG" }, { status: 403 });
  }

  if (parsed.data.slug) {
    const dupe = await prisma.event.findUnique({ where: { slug: parsed.data.slug } });
    if (dupe) return NextResponse.json({ error: "SLUG_TAKEN" }, { status: 409 });
  }

  const ev = await prisma.event.create({
    data: {
      centreId,
      title: parsed.data.title,
      type: parsed.data.type,
      description: parsed.data.description,
      externalVenue: parsed.data.externalVenue,
      externalHostOrg: parsed.data.externalHostOrg,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      fee: parsed.data.fee,
      capacity: parsed.data.capacity ?? null,
      isPublic: parsed.data.isPublic,
      slug: parsed.data.slug ?? null,
      contactName: parsed.data.contactName,
      contactPhone: parsed.data.contactPhone,
      notes: parsed.data.notes,
      status: "draft",
    },
  });

  await audit({
    userId: session.userId,
    action: "event.create",
    tableName: "event",
    rowId: ev.id,
    after: { title: ev.title, type: ev.type, startDate: ev.startDate },
  });

  return NextResponse.json({ id: ev.id });
}

// GET — list events with optional ?status= and ?type= filters. Tenant-
// scoped to the caller's centre unless SUPER_ADMIN.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const orgId = await getOrgIdForSession(session);
  if (!orgId) return NextResponse.json({ error: "NO_ORG" }, { status: 403 });
  const url = new URL(req.url);
  const centreId = scopeCentre(session);
  const where: Prisma.EventWhereInput = { ...tenantWhere(centreId, orgId) };
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");
  if (status) where.status = status;
  if (type) where.type = type;
  const rows = await prisma.event.findMany({
    where,
    orderBy: { startDate: "desc" },
    take: 100,
    include: { _count: { select: { registrations: true } } },
  });
  return NextResponse.json({ events: rows });
}
