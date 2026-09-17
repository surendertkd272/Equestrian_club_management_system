import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { resolveWriteCentre } from "@/lib/resolve-centre";
import { audit } from "@/lib/audit";
import { blockIfReadOnly } from "@/lib/readonly-gate";

// Partner schools, and which administrator is fenced to which.
//
// The fence itself lives on User.schoolId; this is the only way to set it.
// Guarded by staff.manage rather than a softer permission because attaching an
// account to a school is an ACCESS decision — and detaching one (schoolId =
// null) widens that account to every child at the centre, which is exactly the
// change that most deserves an audit entry.

const createSchema = z.object({
  name: z.string().trim().min(2, "School name is too short").max(120),
});

const assignSchema = z.object({
  userId: z.string().min(1),
  // null detaches — the account goes back to seeing the whole centre.
  schoolId: z.string().min(1).nullable(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const url = new URL(req.url);
  const resolved = await resolveWriteCentre(session, {
    centreId: url.searchParams.get("centreId") ?? undefined,
  });
  if (resolved.error) return resolved.error;
  const centreId = resolved.centreId;

  const existing = await prisma.school.findUnique({
    where: { centreId_name: { centreId, name: parsed.data.name } },
  });
  if (existing) {
    return NextResponse.json({ error: "ALREADY_EXISTS", id: existing.id }, { status: 409 });
  }

  const school = await prisma.school.create({
    data: { centreId, name: parsed.data.name },
  });
  await audit({
    userId: session.userId,
    action: "create",
    tableName: "school",
    rowId: school.id,
    after: { name: school.name, centreId },
  });
  return NextResponse.json({ id: school.id, name: school.name });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!can(session.role, "staff.manage")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const readOnlyBlock = await blockIfReadOnly(session);
  if (readOnlyBlock) return readOnlyBlock;

  const body = await req.json().catch(() => null);
  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const url = new URL(req.url);
  const resolved = await resolveWriteCentre(session, {
    centreId: url.searchParams.get("centreId") ?? undefined,
  });
  if (resolved.error) return resolved.error;
  const centreId = resolved.centreId;

  // The target must be a school administrator AT THIS CENTRE. Without the
  // centre check a caller could point any user id at their own school; without
  // the role check they could quietly attach a coach, whose access is decided
  // elsewhere and would not change, leaving a misleading row behind.
  const user = await prisma.user.findFirst({
    where: { id: parsed.data.userId, centreId, role: "SCHOOL_ADMINISTRATOR" },
    select: { id: true, name: true, schoolId: true },
  });
  if (!user) {
    return NextResponse.json(
      { error: "NOT_FOUND", message: "No school administrator at this centre with that id." },
      { status: 404 },
    );
  }

  // And the school must belong to the same centre, or this becomes a way to
  // fence an account to another club's school.
  if (parsed.data.schoolId) {
    const school = await prisma.school.findFirst({
      where: { id: parsed.data.schoolId, centreId },
      select: { id: true },
    });
    if (!school) {
      return NextResponse.json(
        { error: "NOT_FOUND", message: "That school isn't at this centre." },
        { status: 404 },
      );
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { schoolId: parsed.data.schoolId },
  });
  await audit({
    userId: session.userId,
    action: "school.assign_admin",
    tableName: "user",
    rowId: user.id,
    before: { schoolId: user.schoolId },
    after: { schoolId: parsed.data.schoolId, name: user.name },
  });
  return NextResponse.json({ ok: true, schoolId: parsed.data.schoolId });
}
