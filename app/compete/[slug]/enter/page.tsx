import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { EntryForm } from "./form";

export const dynamic = "force-dynamic";

export default async function EnterPage({ params }: { params: { slug: string } }) {
  const comp = await prisma.competition.findUnique({
    where: { slug: params.slug },
    select: { id: true, name: true, slug: true, classesJson: true, status: true, scope: true, entryDeadline: true },
  });
  if (!comp || comp.status === "draft" || comp.status === "cancelled") notFound();

  const classes: Array<{ name: string; fee?: number; ageGroup?: string; maxEntries?: number }> = (() => {
    try { return JSON.parse(comp.classesJson); } catch { return []; }
  })();
  const open = comp.status === "open_for_entries" && (!comp.entryDeadline || comp.entryDeadline > new Date());

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="container mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href={`/compete/${comp.slug}`} className="text-sm text-slate-600 hover:text-primary">← Back</Link>
        </div>
      </header>
      <section className="container mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-bold">Enter {comp.name}</h1>
        {!open ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Entries are closed. {comp.entryDeadline && `Deadline was ${new Date(comp.entryDeadline).toLocaleString("en-IN")}.`}
          </p>
        ) : classes.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No classes published yet.</p>
        ) : (
          <EntryForm
            slug={comp.slug}
            classes={classes.map((c) => ({ name: c.name, fee: c.fee ?? null }))}
            scope={comp.scope}
          />
        )}
      </section>
    </main>
  );
}
