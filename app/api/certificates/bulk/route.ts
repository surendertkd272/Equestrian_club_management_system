import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { blockIfReadOnly } from "@/lib/readonly-gate";
import { generateUniqueSerial, verifyUrl } from "@/lib/cert";
import { audit } from "@/lib/audit";

// Bulk certificate issuance. Two modes:
//   • event           — issue an "event_attendance" cert per attended rider
//   • exam_sitting    — issue "promotion" certs per PASSED exam in a sitting
//
// Every cert in a batch shares a `batchTag` so the UI can show the
// grouping and the bulk PDF zip can re-find them.
//
// Payload shape:
//   { source: "event" | "exam_sitting", sourceId: "..." }
//
// Returns: { issued, alreadyHad, batchTag }

const schema = z.object({
  source: z.enum(["event", "exam_sitting"]),
  sourceId: z.string().min(1),
  // Optional override of the auto-generated batchTag (handy for HR runs
  // like "march_2026_certs").
  batchTag: z.string().max(60).optional(),
  // For event-attendance certs, whether to issue ONLY for status=attended
  // (default) or for everyone non-cancelled (override=true).
  includeRegistered: z.boolean().default(false),
  // For event certs — the title shown on the cert. Defaults to event title.
  certTitle: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "certificates");
  if (featureBlock) return featureBlock;
  if (!can(session.role, "certificate.bulk")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const { source, sourceId } = parsed.data;
  const batchTag = parsed.data.batchTag ?? `${source}:${sourceId}:${Date.now()}`;

  let issued = 0;
  let alreadyHad = 0;
  let centreId = "";

  if (source === "event") {
    const ev = await prisma.event.findUnique({ where: { id: sourceId }, include: { registrations: true } });
    if (!ev) return NextResponse.json({ error: "EVENT_NOT_FOUND" }, { status: 404 });
    if (session.role !== "SUPER_ADMIN" && ev.centreId !== session.centreId) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
    }
    centreId = ev.centreId;

    // Pick recipients
    const eligible = ev.registrations.filter((r) =>
      parsed.data.includeRegistered
        ? r.status !== "cancelled"
        : r.status === "attended",
    );
    // Skip riders that already have an event_attendance cert for this event
    const existing = await prisma.certificate.findMany({
      where: { riderId: { in: eligible.map((r) => r.riderId) }, type: "event_attendance", levelName: { contains: ev.title } },
      select: { riderId: true },
    });
    const already = new Set(existing.map((c) => c.riderId));

    for (const r of eligible) {
      if (already.has(r.riderId)) {
        alreadyHad++;
        continue;
      }
      const serial = await generateUniqueSerial(10_000 + issued);
      await prisma.certificate.create({
        data: {
          centreId,
          riderId: r.riderId,
          type: "event_attendance",
          levelName: parsed.data.certTitle ?? ev.title,
          serialNo: serial,
          qrCode: verifyUrl(serial),
          signedBy: session.userId,
          batchTag,
        },
      });
      issued++;
    }
  } else if (source === "exam_sitting") {
    const sitting = await prisma.examSitting.findUnique({
      where: { id: sourceId },
      include: { exams: true },
    });
    if (!sitting) return NextResponse.json({ error: "SITTING_NOT_FOUND" }, { status: 404 });
    if (session.role !== "SUPER_ADMIN" && sitting.centreId !== session.centreId) {
      return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
    }
    centreId = sitting.centreId;

    // Only PASSED + completed exams qualify for promotion certs.
    const passed = sitting.exams.filter((e) => e.status === "completed" && e.passed === true);
    const existing = await prisma.certificate.findMany({
      where: { examId: { in: passed.map((e) => e.id) }, type: "promotion" },
      select: { examId: true },
    });
    const already = new Set(existing.map((c) => c.examId));

    // Fetch template names per level so the cert says "Level 1 — Beginner"
    const templates = await prisma.scoringTemplate.findMany({
      where: { centreId, levelKey: { in: passed.map((e) => String(e.level)) } },
      select: { levelKey: true, levelName: true },
    });
    const levelName = new Map(templates.map((t) => [t.levelKey, t.levelName]));

    for (const ex of passed) {
      if (already.has(ex.id)) {
        alreadyHad++;
        continue;
      }
      const serial = await generateUniqueSerial(ex.level);
      await prisma.certificate.create({
        data: {
          centreId,
          riderId: ex.riderId,
          examId: ex.id,
          type: "promotion",
          levelName: levelName.get(String(ex.level)) ?? `Level ${ex.level}`,
          serialNo: serial,
          qrCode: verifyUrl(serial),
          signedBy: session.userId,
          batchTag,
        },
      });
      issued++;
    }
  }

  await audit({
    userId: session.userId,
    action: "certificate.bulk_issue",
    tableName: "certificate",
    rowId: batchTag,
    after: { source, sourceId, issued, alreadyHad, centreId },
  });

  return NextResponse.json({ issued, alreadyHad, batchTag });
}
