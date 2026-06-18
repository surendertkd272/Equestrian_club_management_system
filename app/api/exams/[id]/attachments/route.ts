import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

const schema = z.object({
  url: z.string().url(),
  kind: z.enum(["video", "photo", "sheet", "other"]),
  caption: z.string().max(200).optional(),
});

// POST — record a file attachment for an exam. The file itself was already
// uploaded via /api/upload (which enforces MIME + size); this row links it
// to the exam and tags its kind so the UI can pick the right icon and the
// sealed-sheet flow can find scanned judge cards.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });

  const exam = await prisma.exam.findUnique({
    where: { id: params.id },
    include: { judges: { select: { judgeId: true } } },
  });
  if (!exam) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (session.role !== "SUPER_ADMIN" && exam.centreId !== session.centreId) {
    return NextResponse.json({ error: "FORBIDDEN_CROSS_CENTRE" }, { status: 403 });
  }
  const isExaminer = exam.examinerId === session.userId || exam.judges.some((j) => j.judgeId === session.userId);
  if (!["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH"].includes(session.role) && !isExaminer) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const block = await blockIfReadOnly(session);
  if (block) return block;

  const row = await prisma.examAttachment.create({
    data: {
      examId: exam.id,
      url: parsed.data.url,
      kind: parsed.data.kind,
      caption: parsed.data.caption ?? null,
      uploadedBy: session.userId,
    },
  });
  await audit({
    userId: session.userId,
    action: "exam.attachment_added",
    tableName: "examAttachment",
    rowId: row.id,
    after: { examId: exam.id, kind: parsed.data.kind },
  });
  return NextResponse.json({ ok: true, id: row.id });
}
