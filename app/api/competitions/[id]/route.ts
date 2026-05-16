import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { updateCompetitionSchema } from "@/lib/schemas/competition";
import { audit } from "@/lib/audit";
import { generateUniqueSerial, verifyUrl } from "@/lib/cert";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = updateCompetitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const comp = await prisma.competition.findUnique({ where: { id: params.id } });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }

  const d = parsed.data;
  const updated = await prisma.competition.update({
    where: { id: comp.id },
    data: {
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.scope !== undefined ? { scope: d.scope } : {}),
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.venue !== undefined ? { venue: d.venue || null } : {}),
      ...(d.entryDeadline !== undefined
        ? { entryDeadline: d.entryDeadline ? new Date(d.entryDeadline) : null }
        : {}),
    },
  });

  await audit({
    userId: session.userId,
    action: "update",
    tableName: "competition",
    rowId: comp.id,
    before: { status: comp.status, name: comp.name, venue: comp.venue },
    after: { status: updated.status, name: updated.name, venue: updated.venue },
  });

  // C7: when status flips to completed, bulk-issue a "participation" cert
  // for every non-withdrawn rider that doesn't already have a competition
  // cert from this comp. Winners (1st/2nd/3rd) keep their winner cert; we
  // skip them so they don't end up with two certs from one event.
  let participationIssued = 0;
  if (d.status === "completed" && comp.status !== "completed") {
    const entries = await prisma.competitionEntry.findMany({
      where: { competitionId: comp.id, status: { not: "withdrawn" } },
      select: { id: true, riderId: true, placement: true },
    });
    const certs = await prisma.certificate.findMany({
      where: { competitionId: comp.id, riderId: { in: entries.map((e) => e.riderId) } },
      select: { riderId: true },
    });
    const already = new Set(certs.map((c) => c.riderId));
    for (const e of entries) {
      if (already.has(e.riderId)) continue;
      // Winners already got a winner cert via the entries PATCH.
      if (e.placement !== null && e.placement <= 3) continue;
      const serial = await generateUniqueSerial(1000 + participationIssued);
      await prisma.certificate.create({
        data: {
          centreId: comp.centreId,
          riderId: e.riderId,
          competitionId: comp.id,
          type: "participation",
          levelName: `Participation · ${comp.name}`,
          serialNo: serial,
          qrCode: verifyUrl(serial),
          signedBy: session.userId,
        },
      });
      already.add(e.riderId);
      participationIssued++;
    }
    if (participationIssued > 0) {
      await audit({
        userId: session.userId,
        action: "certificate.auto_issue_participation",
        tableName: "competition",
        rowId: comp.id,
        after: { count: participationIssued },
      });
    }
  }

  return NextResponse.json({ ok: true, participationIssued });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "competition.manage")) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const comp = await prisma.competition.findUnique({ where: { id: params.id } });
  if (!comp) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && comp.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  if (comp.status === "completed" || comp.status === "live") {
    return NextResponse.json({ error: "ACTIVE_OR_COMPLETED", message: "Cannot delete a live or completed competition." }, { status: 409 });
  }
  await prisma.competition.delete({ where: { id: comp.id } });
  await audit({ userId: session.userId, action: "delete", tableName: "competition", rowId: comp.id, before: comp });
  return NextResponse.json({ ok: true });
}
