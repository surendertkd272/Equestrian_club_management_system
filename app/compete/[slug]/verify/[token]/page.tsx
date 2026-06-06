import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { hashEntryToken } from "@/lib/external-entry-token";

export const dynamic = "force-dynamic";

// Magic-link landing for external-entry verification. Server-side flips
// verifiedAt + consumes the token. Idempotent within the single-use guard.
export default async function VerifyEntryPage({ params }: { params: { slug: string; token: string } }) {
  const tokenHash = hashEntryToken(params.token);
  const entry = await prisma.externalEntry.findUnique({ where: { verifyTokenHash: tokenHash } });

  let status: "ok" | "expired" | "used" | "invalid" = "invalid";
  if (entry) {
    if (entry.verifiedAt) status = "ok";
    else if (entry.verifyExpiresAt && entry.verifyExpiresAt < new Date()) status = "expired";
    else {
      // Consume — set verifiedAt + clear the token hash so the link can't be reused.
      await prisma.externalEntry.update({
        where: { id: entry.id },
        data: { verifiedAt: new Date(), verifyTokenHash: null },
      });
      status = "ok";
    }
  }

  return (
    <main className="min-h-screen bg-muted/40">
      <section className="container mx-auto max-w-md px-6 py-16">
        <div className="rounded-lg border bg-card p-6 text-center">
          {status === "ok" ? (
            <>
              <div className="text-3xl">✓</div>
              <h1 className="mt-3 text-xl font-bold">Entry confirmed</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Thanks{entry ? `, ${entry.firstName}` : ""}. The organiser will review and approve.
                You'll get a second email when you're on the start list.
              </p>
            </>
          ) : status === "expired" ? (
            <>
              <div className="text-3xl">⏱</div>
              <h1 className="mt-3 text-xl font-bold">Link expired</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Verification links last 48 hours. Submit your entry again to receive a fresh link.
              </p>
            </>
          ) : (
            <>
              <div className="text-3xl">✗</div>
              <h1 className="mt-3 text-xl font-bold">Link invalid</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This link is unrecognised. It may have been used already or copied incorrectly.
              </p>
            </>
          )}
          <Link href={`/compete/${params.slug}`} className="mt-4 inline-block text-sm text-primary underline">
            Back to the competition
          </Link>
        </div>
      </section>
    </main>
  );
}
