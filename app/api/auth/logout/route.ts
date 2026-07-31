import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { clearSessionCookie, verifySession, COOKIE_NAME } from "@/lib/auth";

// POST /api/auth/logout
//
// Deleting the cookie only tells the BROWSER to forget the token. It said
// nothing to the server, so a copy of that JWT — a shared machine, a synced
// browser profile, a captured request — stayed valid for the rest of its 8h
// life after the user pressed "Sign out".
//
// So we also deny-list the token's `jti`. Deliberately not a tokenVersion bump:
// that would sign the user out on every device at once, and signing out of one
// laptop shouldn't kill the phone in their pocket. "Sign out everywhere"
// (/api/account/sign-out-everywhere) is the tokenVersion bump, and stays the
// way to do that on purpose.
export async function POST() {
  const token = cookies().get(COOKIE_NAME)?.value;

  if (token) {
    // Verify rather than decode: only a token we actually issued is worth a row,
    // otherwise anyone could fill the table with junk jtis.
    const payload = await verifySession(token);
    if (payload?.jti) {
      const ttlMin = Number(process.env.JWT_ACCESS_TTL_MIN ?? 480);
      try {
        await prisma.revokedSession.upsert({
          where: { jti: payload.jti },
          create: {
            jti: payload.jti,
            userId: payload.userId,
            // Keep the row only as long as the token could still be presented.
            expiresAt: new Date(Date.now() + ttlMin * 60_000),
          },
          update: {},
        });
      } catch (err) {
        // Never let bookkeeping keep someone signed in — clear the cookie
        // regardless and log for ops.
        console.error("[logout] failed to record session revocation", err);
      }
    }
  }

  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
