import { NextResponse } from "next/server";
import { issueChallenge } from "@/lib/captcha";

// Public — issues a new math challenge. Anti-flood: the rate-limit on
// the routes that *verify* the challenge is what actually constrains
// abuse; issuing tokens is cheap and stateless.
export async function GET() {
  return NextResponse.json(issueChallenge());
}
