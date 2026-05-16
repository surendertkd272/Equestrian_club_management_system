import { NextResponse } from "next/server";
import { clearOwnerSessionCookie } from "@/lib/owner-auth";

export async function POST() {
  await clearOwnerSessionCookie();
  return NextResponse.json({ ok: true });
}
