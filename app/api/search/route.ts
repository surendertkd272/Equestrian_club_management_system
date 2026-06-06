import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { scopeCentre } from "@/lib/tenancy";

// GET /api/search?q=… — backing for the Cmd+K palette.
//
// Queries nine domains in parallel: riders, horses, users, centres,
// certificates, exams, competitions, batches, medicines. Each returns at
// most 5 results so the palette stays tight. Centre-scoping is enforced for
// non-SUPER_ADMIN sessions; HQ sees platform-wide.
//
// The route deliberately avoids fancy ranking — alphabetic per-domain is
// good enough at this scale. Each hit carries `kind`, `id`, `href`,
// `primary`, `secondary` for the palette to render uniformly.

export type SearchHit = {
  kind:
    | "rider"
    | "horse"
    | "user"
    | "centre"
    | "certificate"
    | "exam"
    | "batch"
    | "medicine";
  id: string;
  href: string;
  primary: string;
  secondary?: string;
};

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ hits: [] });

  // Centre scoping. SUPER_ADMIN sees everything; others see their centre.
  const centreId = scopeCentre(session);
  const centreFilter = centreId ? { centreId } : {};
  const ridersWhere = centreId ? { ...centreFilter } : {};
  const horsesWhere = centreId ? { ...centreFilter } : {};
  const certsWhere = centreId ? { ...centreFilter } : {};

  const [riders, horses, users, centres, certs, exams, batches, meds] = await Promise.all([
    prisma.rider.findMany({
      where: {
        ...ridersWhere,
        OR: [
          { firstName: { contains: q } },
          { lastName: { contains: q } },
          { mobile: { contains: q } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, mobile: true },
      take: 5,
      orderBy: { firstName: "asc" },
    }),
    prisma.horse.findMany({
      where: {
        ...horsesWhere,
        OR: [
          { name: { contains: q } },
          { stableNo: { contains: q } },
          { microchip: { contains: q } },
        ],
      },
      select: { id: true, name: true, stableNo: true, breed: true },
      take: 5,
      orderBy: { name: "asc" },
    }),
    // Users — only SUPER_ADMIN can search them (Centre managers can but only
    // their centre's). Keeps PII tight.
    session.role === "SUPER_ADMIN"
      ? prisma.user.findMany({
          where: {
            OR: [{ name: { contains: q } }, { email: { contains: q } }],
          },
          select: { id: true, name: true, email: true, role: true, centre: { select: { name: true } } },
          take: 5,
          orderBy: { name: "asc" },
        })
      : prisma.user.findMany({
          where: {
            centreId: session.centreId ?? undefined,
            OR: [{ name: { contains: q } }, { email: { contains: q } }],
          },
          select: { id: true, name: true, email: true, role: true, centre: { select: { name: true } } },
          take: 5,
          orderBy: { name: "asc" },
        }),
    // Centres — HQ-only.
    session.role === "SUPER_ADMIN"
      ? prisma.centre.findMany({
          where: { OR: [{ name: { contains: q } }, { slug: { contains: q.toLowerCase() } }] },
          select: { id: true, name: true, slug: true },
          take: 5,
          orderBy: { name: "asc" },
        })
      : [],
    prisma.certificate.findMany({
      where: {
        ...certsWhere,
        OR: [
          { serialNo: { contains: q } },
          { levelName: { contains: q } },
        ],
      },
      select: { id: true, serialNo: true, levelName: true, type: true, rider: { select: { firstName: true, lastName: true } } },
      take: 5,
      orderBy: { issuedAt: "desc" },
    }),
    // Exams — look up by examiner name or rider name.
    prisma.exam.findMany({
      where: {
        ...(centreId ? centreFilter : {}),
        OR: [
          { examinerName: { contains: q } },
          { rider: { firstName: { contains: q } } },
          { rider: { lastName: { contains: q } } },
        ],
      },
      select: {
        id: true,
        level: true,
        date: true,
        examinerName: true,
        status: true,
        rider: { select: { firstName: true, lastName: true } },
      },
      take: 5,
      orderBy: { date: "desc" },
    }),
    prisma.batch.findMany({
      where: {
        ...(centreId ? centreFilter : {}),
        OR: [{ name: { contains: q } }, { level: { contains: q } }],
      },
      select: { id: true, name: true, level: true, dayOfWeek: true, startTime: true },
      take: 5,
      orderBy: { name: "asc" },
    }),
    prisma.medicine.findMany({
      where: {
        ...(centreId ? centreFilter : {}),
        OR: [{ name: { contains: q } }, { generic: { contains: q } }, { batchNo: { contains: q } }],
      },
      select: { id: true, name: true, generic: true, category: true, qty: true },
      take: 5,
      orderBy: { name: "asc" },
    }),
  ]);

  const hits: SearchHit[] = [
    ...riders.map((r) => ({
      kind: "rider" as const,
      id: r.id,
      href: `/riders/${r.id}`,
      primary: `${r.firstName} ${r.lastName}`,
      secondary: r.mobile,
    })),
    ...horses.map((h) => ({
      kind: "horse" as const,
      id: h.id,
      href: `/horses/${h.id}`,
      primary: h.name,
      secondary: [h.stableNo, h.breed].filter(Boolean).join(" · ") || undefined,
    })),
    ...users.map((u) => ({
      kind: "user" as const,
      id: u.id,
      href: "/users",
      primary: u.name,
      secondary: `${u.email} · ${u.role}${u.centre ? ` · ${u.centre.name}` : ""}`,
    })),
    ...(Array.isArray(centres) ? centres : []).map((c: any) => ({
      kind: "centre" as const,
      id: c.id,
      href: "/centres",
      primary: c.name,
      secondary: c.slug,
    })),
    ...certs.map((c) => ({
      kind: "certificate" as const,
      id: c.id,
      href: `/certificates/${c.id}`,
      primary: c.serialNo,
      secondary: `${c.rider.firstName} ${c.rider.lastName}${c.levelName ? ` · ${c.levelName}` : ""}`,
    })),
    ...exams.map((e) => ({
      kind: "exam" as const,
      id: e.id,
      href: `/exams/${e.id}`,
      primary: `Level ${e.level} · ${e.rider.firstName} ${e.rider.lastName}`,
      secondary: `${e.date.toISOString().slice(0, 10)} · ${e.examinerName ?? "Unassigned"} · ${e.status}`,
    })),
    ...batches.map((b) => ({
      kind: "batch" as const,
      id: b.id,
      href: `/batches`,
      primary: b.name,
      secondary: `${b.dayOfWeek} ${b.startTime}${b.level ? ` · ${b.level}` : ""}`,
    })),
    ...meds.map((m) => ({
      kind: "medicine" as const,
      id: m.id,
      href: `/medicines`,
      primary: m.name,
      secondary: `${m.category}${m.generic ? ` · ${m.generic}` : ""} · qty ${m.qty}`,
    })),
  ];

  return NextResponse.json({ hits });
}
