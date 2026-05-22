import { NextRequest, NextResponse } from "next/server";
import { uploadFile, type UploadKind } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";

// Mixed endpoint — most kinds (rider_* during onboarding) need to work
// pre-auth, but user_photo is an authed self-service action. The route
// branches on kind: anon for onboarding kinds, getSession() required for
// the rest.

const ALLOWED_KINDS: UploadKind[] = ["rider_photo", "rider_aadhaar", "rider_indemnity", "horse_photo", "asset_photo", "user_photo", "staff_aadhaar", "staff_police_verification", "expense_invoice", "generic"];
// Kinds reachable from the public onboarding wizard. Everything else must
// belong to a signed-in user so anonymous traffic can't seed avatar URLs.
const ANON_KINDS: ReadonlySet<UploadKind> = new Set(["rider_photo", "rider_aadhaar", "rider_indemnity", "generic"]);

export const runtime = "nodejs"; // we use node:fs in the storage impl

// Cap raw body at 6MB at the framework boundary — storage policy will further enforce per-kind.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "BAD_FORM_DATA" }, { status: 400 });
  }

  const kindRaw = formData.get("kind");
  const file = formData.get("file");

  const kind = (typeof kindRaw === "string" ? kindRaw : "generic") as UploadKind;
  if (!ALLOWED_KINDS.includes(kind)) {
    return NextResponse.json({ error: "INVALID_KIND", available: ALLOWED_KINDS }, { status: 400 });
  }
  // Non-onboarding kinds require a logged-in session.
  if (!ANON_KINDS.has(kind)) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "FILE_REQUIRED" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const result = await uploadFile({ kind, buffer: buf, mime: file.type });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null;
  await audit({
    action: "upload",
    tableName: "file",
    rowId: result.url,
    after: { kind, mime: result.mime, size: result.size, originalName: file.name },
    ip,
    userAgent: req.headers.get("user-agent") ?? null,
  });

  return NextResponse.json({ url: result.url, mime: result.mime, size: result.size });
}
