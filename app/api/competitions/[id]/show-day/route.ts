import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// Single umbrella endpoint for the four specialist show-day logs:
// vet checks, stable allocations, drug tests, protests. Keeping them in
// one route avoids four near-identical files; the `resource` query
// parameter switches between them.
//
//   GET  ?resource=vet_checks | stables | drug_tests | protests
//   POST same parameter + a JSON body matching the appropriate schema

const RESOURCES = ["vet_checks", "stables", "drug_tests", "protests"] as const;
type Resource = (typeof RESOURCES)[number];

const vetCheckSchema = z.object({
  horseId: z.string().optional().nullable(),
  horseName: z.string().min(1).max(80),
  riderName: z.string().max(120).optional().nullable(),
  phase: z.enum([
    "pre_event",
    "first_horse_inspection",
    "hold_reinspect",
    "second_horse_inspection",
    "post_event",
    "trot_up",
  ]),
  status: z.enum(["pass", "hold", "fail", "not_presented"]).default("pass"),
  vetUserId: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

const stableSchema = z.object({
  boxNo: z.string().min(1).max(20),
  horseId: z.string().optional().nullable(),
  horseName: z.string().min(1).max(80),
  riderName: z.string().min(1).max(120),
  arrivalAt: z.string().optional().nullable(),
  departureAt: z.string().optional().nullable(),
  notes: z.string().max(300).optional().nullable(),
});

const drugTestSchema = z.object({
  horseId: z.string().optional().nullable(),
  horseName: z.string().min(1).max(80),
  riderName: z.string().min(1).max(120),
  sampleType: z.enum(["urine", "blood", "hair"]),
  sampleId: z.string().min(1).max(40),
  collectedBy: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

const protestSchema = z.object({
  filedByUserId: z.string().optional().nullable(),
  filedByName: z.string().min(1).max(120),
  subject: z.string().min(1).max(160),
  body: z.string().min(1).max(4000),
  feeAmount: z.coerce.number().min(0).max(50000).optional().nullable(),
  feePaid: z.boolean().default(false),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const url = new URL(req.url);
  const resource = url.searchParams.get("resource") as Resource | null;
  if (!resource || !RESOURCES.includes(resource)) {
    return NextResponse.json({ error: "BAD_RESOURCE", allowed: RESOURCES }, { status: 400 });
  }

  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  switch (resource) {
    case "vet_checks":
      return NextResponse.json({
        rows: await prisma.vetCheck.findMany({
          where: { competitionId: comp.id },
          orderBy: { performedAt: "desc" },
          take: 200,
        }),
      });
    case "stables":
      return NextResponse.json({
        rows: await prisma.stableAllocation.findMany({
          where: { competitionId: comp.id },
          orderBy: { boxNo: "asc" },
          take: 500,
        }),
      });
    case "drug_tests":
      return NextResponse.json({
        rows: await prisma.drugTest.findMany({
          where: { competitionId: comp.id },
          orderBy: { collectedAt: "desc" },
          take: 200,
        }),
      });
    case "protests":
      return NextResponse.json({
        rows: await prisma.protest.findMany({
          where: { competitionId: comp.id },
          orderBy: { filedAt: "desc" },
          take: 200,
        }),
      });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const readOnly = await blockIfReadOnly(session);
  if (readOnly) return readOnly;

  const url = new URL(req.url);
  const resource = url.searchParams.get("resource") as Resource | null;
  if (!resource || !RESOURCES.includes(resource)) {
    return NextResponse.json({ error: "BAD_RESOURCE", allowed: RESOURCES }, { status: 400 });
  }

  const comp = await prisma.competition.findUnique({
    where: { id: params.id },
    select: { id: true, centreId: true },
  });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);

  switch (resource) {
    case "vet_checks": {
      const p = vetCheckSchema.safeParse(body);
      if (!p.success) return NextResponse.json({ error: "VALIDATION", details: p.error.flatten() }, { status: 400 });
      const row = await prisma.vetCheck.create({
        data: {
          competitionId: comp.id,
          horseId: p.data.horseId ?? null,
          horseName: p.data.horseName,
          riderName: p.data.riderName ?? null,
          phase: p.data.phase,
          status: p.data.status,
          vetUserId: p.data.vetUserId ?? null,
          notes: p.data.notes ?? null,
        },
      });
      await audit({ userId: session.userId, action: "competition.vet_check", tableName: "vetCheck", rowId: row.id, after: row });
      return NextResponse.json({ ok: true, id: row.id });
    }
    case "stables": {
      const p = stableSchema.safeParse(body);
      if (!p.success) return NextResponse.json({ error: "VALIDATION", details: p.error.flatten() }, { status: 400 });
      try {
        const row = await prisma.stableAllocation.create({
          data: {
            competitionId: comp.id,
            boxNo: p.data.boxNo,
            horseId: p.data.horseId ?? null,
            horseName: p.data.horseName,
            riderName: p.data.riderName,
            arrivalAt: p.data.arrivalAt ? new Date(p.data.arrivalAt) : null,
            departureAt: p.data.departureAt ? new Date(p.data.departureAt) : null,
            notes: p.data.notes ?? null,
          },
        });
        await audit({ userId: session.userId, action: "competition.stable_allocated", tableName: "stableAllocation", rowId: row.id, after: row });
        return NextResponse.json({ ok: true, id: row.id });
      } catch (e: any) {
        if (e?.code === "P2002") return NextResponse.json({ error: "BOX_ALREADY_ALLOCATED" }, { status: 409 });
        throw e;
      }
    }
    case "drug_tests": {
      const p = drugTestSchema.safeParse(body);
      if (!p.success) return NextResponse.json({ error: "VALIDATION", details: p.error.flatten() }, { status: 400 });
      try {
        const row = await prisma.drugTest.create({
          data: {
            competitionId: comp.id,
            horseId: p.data.horseId ?? null,
            horseName: p.data.horseName,
            riderName: p.data.riderName,
            sampleType: p.data.sampleType,
            sampleId: p.data.sampleId,
            collectedBy: p.data.collectedBy ?? session.userId,
            notes: p.data.notes ?? null,
          },
        });
        await audit({ userId: session.userId, action: "competition.drug_sample_collected", tableName: "drugTest", rowId: row.id, after: { sampleId: row.sampleId, horseName: row.horseName } });
        return NextResponse.json({ ok: true, id: row.id });
      } catch (e: any) {
        if (e?.code === "P2002") return NextResponse.json({ error: "DUPLICATE_SAMPLE_ID" }, { status: 409 });
        throw e;
      }
    }
    case "protests": {
      const p = protestSchema.safeParse(body);
      if (!p.success) return NextResponse.json({ error: "VALIDATION", details: p.error.flatten() }, { status: 400 });
      const row = await prisma.protest.create({
        data: {
          competitionId: comp.id,
          filedByUserId: p.data.filedByUserId ?? null,
          filedByName: p.data.filedByName,
          subject: p.data.subject,
          body: p.data.body,
          feeAmount: p.data.feeAmount ?? null,
          feePaid: p.data.feePaid,
        },
      });
      await audit({ userId: session.userId, action: "competition.protest_filed", tableName: "protest", rowId: row.id, after: { subject: row.subject, filedByName: row.filedByName } });
      return NextResponse.json({ ok: true, id: row.id });
    }
  }
}
