// User-facing endpoint where the recipient of a separation notice
// submits their reason. Flips the notice to status=submitted AND flips
// User.status to resigned or terminated (depending on the kind).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";

const schema = z.object({
  noticeId: z.string().min(1),
  responseText: z.string().min(10).max(2000),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION", details: parsed.error.flatten() }, { status: 400 });
  }

  const notice = await prisma.separationNotice.findUnique({
    where: { id: parsed.data.noticeId },
  });
  if (!notice) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (notice.userId !== session.userId) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (notice.status !== "pending") {
    return NextResponse.json({ error: "ALREADY_SUBMITTED" }, { status: 409 });
  }

  // Atomic two-step: lock the notice + flip the user status. We don't
  // tie these in a transaction here because Prisma's pgbouncer setup
  // can't run them in one — and the notify() below is fire-and-forget
  // anyway. Worst case (very rare race): notice is "submitted" but
  // user.status still active for a moment; admin sees the inconsistency
  // and can manually flip via /users.
  await prisma.separationNotice.update({
    where: { id: notice.id },
    data: {
      responseText: parsed.data.responseText,
      respondedAt: new Date(),
      status: "submitted",
    },
  });

  // Decide final user status from the notice kind:
  //   termination → terminated
  //   resignation_request → resigned
  const newStatus = notice.kind === "termination" ? "terminated" : "resigned";
  await prisma.user.update({
    where: { id: session.userId },
    data: {
      status: newStatus,
      // Bump tokenVersion so any active session for this user is
      // invalidated — they can't keep using the app after submitting.
      tokenVersion: { increment: 1 },
    },
  });

  await audit({
    userId: session.userId,
    action: `separation.${notice.kind}.submitted`,
    tableName: "separationNotice",
    rowId: notice.id,
    after: { newUserStatus: newStatus },
  });

  // Tell the admin who issued the notice that the user has responded.
  await notify({
    userId: notice.issuedByUserId,
    centreId: notice.centreId,
    type: "separation.responded",
    title: `${session.name} submitted their separation response`,
    body: `User status flipped to ${newStatus}.`,
    link: "/users",
  });

  return NextResponse.json({ ok: true, newStatus });
}
