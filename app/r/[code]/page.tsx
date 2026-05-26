// Public deep-link redemption. The user lands here from a WhatsApp message
// (or other share channel). We look up the code, validate, increment the
// redemption counter, then send them to the target form with pre-filled
// query params.
//
// If the target requires auth, the middleware kicks in after our redirect
// and bounces them through /login?next=… so they retain context.

import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ShortLinkRedeem({ params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  if (!/^[0-9A-Z]{4,16}$/.test(code)) notFound();

  const link = await prisma.shortLink.findUnique({ where: { code } });
  if (!link) {
    return (
      <ExpiredOrBadCodeMessage
        title="Link not found"
        body="This link doesn't exist or has been removed by the centre admin."
      />
    );
  }

  if (link.expiresAt && link.expiresAt < new Date()) {
    return (
      <ExpiredOrBadCodeMessage
        title="Link expired"
        body="Ask the centre admin to send you a fresh link — this one has expired."
      />
    );
  }

  if (link.singleUse && link.redeemCount > 0) {
    return (
      <ExpiredOrBadCodeMessage
        title="Link already used"
        body="This was a one-time link and has already been redeemed."
      />
    );
  }

  // Bump counters before redirect. Best-effort — if the row was deleted
  // between findUnique and update we just continue.
  await prisma.shortLink
    .update({
      where: { id: link.id },
      data: {
        redeemCount: { increment: 1 },
        lastRedeemedAt: new Date(),
      },
    })
    .catch(() => null);

  // Build the destination URL — base path from the catalog + query string
  // from the stored params. For staff_hire links we append the code as a
  // path segment so /staff-register/[code]/page.tsx can validate it
  // server-side (the form POST also re-validates).
  let target = link.targetPath;
  if (link.kind === "staff_hire" && target === "/staff-register") {
    target = `/staff-register/${link.code}`;
  }
  if (link.paramsJson) {
    try {
      const params = JSON.parse(link.paramsJson) as Record<string, string>;
      const qs = new URLSearchParams(params).toString();
      if (qs) target += (target.includes("?") ? "&" : "?") + qs;
    } catch {
      // Bad JSON shouldn't block the user — fall through to the bare path.
    }
  }

  redirect(target);
}

function ExpiredOrBadCodeMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary p-4">
      <div className="w-full max-w-sm space-y-3 rounded-lg border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        <Link href="/login" className="inline-block text-sm text-primary underline">
          Sign in instead
        </Link>
      </div>
    </main>
  );
}
