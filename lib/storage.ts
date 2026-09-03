// File storage abstraction. Three backends — chosen at request time based on env config:
//   1. S3 (or any S3-compatible: AWS S3, Cloudflare R2, DigitalOcean Spaces) when S3_BUCKET +
//      S3_ACCESS_KEY + S3_SECRET + S3_PUBLIC_URL are all set. Explicit config wins.
//   2. Supabase Storage when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
//      (they already are wherever the app's Supabase Postgres lives). Writes via the
//      Storage REST API into SUPABASE_STORAGE_BUCKET (default "uploads") — a public
//      bucket, so reads need no auth. Pure fetch, no SDK (same pattern as lib/email.ts).
//   3. Local filesystem (public/uploads/<filename>) as the dev fallback otherwise.
//
// All backends return the same URL shape: `/uploads/<filename>`. In S3/Supabase mode, the
// `/uploads/:path*` rewrite in next.config.mjs forwards reads to the backend's public
// base URL, so DB rows stay portable across backends and bucket migrations (rebind the
// env without touching stored URLs).
//
// Security model (unchanged from the original design): files are public-by-
// unguessable-filename — 16 random bytes per name. Sensitive docs (Aadhaar etc.)
// rely on that; if per-file authz is ever needed, switch the bucket to private
// and serve through a signed-URL route instead.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export type UploadKind =
  | "rider_photo"
  | "rider_aadhaar"
  | "rider_indemnity"
  | "horse_photo"
  | "asset_photo"
  | "user_photo"
  | "staff_aadhaar"
  | "staff_police_verification"
  | "expense_invoice"
  // Proof of a fee received — a UPI screenshot, a bank slip, a scanned cash
  // receipt. Session-only: never in ANON_KINDS, because unlike a registration
  // document nobody uploads this before they have an account.
  | "payment_proof"
  // Employee self-registration docs (Aadhaar, PAN, bank proof, certificates,
  // photo). Public — uploaded from the tokenised onboarding link.
  | "onboarding_doc"
  | "generic";

// Per-kind MIME whitelist + size cap. Keep tight — the upload route is public.
const POLICY: Record<UploadKind, { mimes: string[]; maxBytes: number }> = {
  rider_photo:               { mimes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024 },
  rider_aadhaar:             { mimes: ["image/jpeg", "image/png", "application/pdf"], maxBytes: 5 * 1024 * 1024 },
  rider_indemnity:           { mimes: ["application/pdf", "image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024 },
  horse_photo:               { mimes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024 },
  asset_photo:               { mimes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024 },
  user_photo:                { mimes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 2 * 1024 * 1024 },
  staff_aadhaar:             { mimes: ["image/jpeg", "image/png", "application/pdf"], maxBytes: 5 * 1024 * 1024 },
  staff_police_verification: { mimes: ["image/jpeg", "image/png", "application/pdf"], maxBytes: 5 * 1024 * 1024 },
  payment_proof:             { mimes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 5 * 1024 * 1024 },
  expense_invoice:           { mimes: ["image/jpeg", "image/png", "application/pdf"], maxBytes: 10 * 1024 * 1024 },
  onboarding_doc:            { mimes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 5 * 1024 * 1024 },
  generic:                   { mimes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 5 * 1024 * 1024 },
};

// Upload-failure shape:
//   error        — machine-readable code (callers can branch on it)
//   message      — USER-facing string; what toasts show. Keep this human
//                  and actionable; never include env var names here.
//   deployerHint — operator-facing string for logs / API debugging. Not
//                  rendered to end users.
export type UploadResult =
  | { ok: true; url: string; size: number; mime: string }
  | { ok: false; error: string; message?: string; deployerHint?: string };

// Map an upload kind to a friendly noun for the "X upload is temporarily
// unavailable" toast. Keeps the message specific without forking the
// entire string per kind.
function uploadNoun(kind: UploadKind): string {
  if (kind.endsWith("_photo")) return "Photo";
  if (kind === "rider_aadhaar" || kind === "staff_aadhaar" || kind === "staff_police_verification") return "Document";
  if (kind === "rider_indemnity") return "Document";
  if (kind === "expense_invoice") return "Invoice";
  return "File";
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function randomFilename(ext: string): string {
  // 16 random bytes → 32 hex chars. Plenty for uniqueness; no collisions in practice.
  return `${crypto.randomBytes(16).toString("hex")}.${ext}`;
}

// Magic-byte sniffer. The browser's Content-Type header is attacker-controlled;
// inspect the first few bytes to confirm the file actually IS what it claims
// to be. Returns the resolved MIME (or null when the bytes don't match any
// supported format).
function detectMimeFromBytes(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "image/png";
  // WebP: "RIFF...WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return "image/webp";
  // PDF: "%PDF-"
  if (
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  )
    return "application/pdf";
  return null;
}

type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function readS3Config(): S3Config | null {
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET;
  // S3_PUBLIC_URL is required so the next.config rewrite has a target — without it
  // we'd write to S3 but /uploads/* would 404 against the empty local dir.
  const publicUrl = process.env.S3_PUBLIC_URL;
  if (!bucket || !accessKeyId || !secretAccessKey || !publicUrl) return null;
  return {
    bucket,
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId,
    secretAccessKey,
  };
}

let _s3Client: S3Client | null = null;
function getS3Client(cfg: S3Config): S3Client {
  if (_s3Client) return _s3Client;
  _s3Client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    // R2/Spaces/MinIO require path-style addressing; AWS-native works with either.
    forcePathStyle: !!cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return _s3Client;
}

type SupabaseStorageConfig = {
  url: string; // project base, e.g. https://<ref>.supabase.co
  serviceKey: string;
  bucket: string;
};

// Reuses the project's existing Supabase URL + service key, but requires an
// EXPLICIT SUPABASE_STORAGE_BUCKET to activate. That opt-in is deliberate:
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present on every dev
// machine (they point at the same project as the app's Postgres), so keying the
// backend purely on their presence would silently route local `next dev`
// uploads into the live production bucket. Gating on SUPABASE_STORAGE_BUCKET —
// which is set only in the deployed env, never in local .env — keeps dev on the
// local-FS fallback. The service-role key stays server-side only (this module
// never ships to the client; the upload route is the sole entry point).
function readSupabaseConfig(): SupabaseStorageConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  if (!url || !serviceKey || !bucket) return null;
  return { url: url.replace(/\/$/, ""), serviceKey, bucket };
}

export async function uploadFile(opts: {
  kind: UploadKind;
  buffer: Buffer;
  mime: string;
}): Promise<UploadResult> {
  const policy = POLICY[opts.kind];
  if (!policy) return { ok: false, error: "INVALID_KIND" };
  if (!policy.mimes.includes(opts.mime)) {
    return { ok: false, error: "MIME_NOT_ALLOWED", message: `Allowed for ${opts.kind}: ${policy.mimes.join(", ")}` };
  }
  // Cheap size / emptiness checks first — they don't need to read the bytes.
  if (opts.buffer.length === 0) {
    return { ok: false, error: "EMPTY" };
  }
  if (opts.buffer.length > policy.maxBytes) {
    return { ok: false, error: "TOO_LARGE", message: `Max ${Math.round(policy.maxBytes / 1024 / 1024)}MB` };
  }
  // Verify the file CONTENTS match the claimed MIME. The browser's
  // Content-Type header is attacker-controlled — an .html file labelled
  // image/jpeg would pass the whitelist above without this check.
  const detected = detectMimeFromBytes(opts.buffer);
  if (detected === null) {
    return { ok: false, error: "UNRECOGNISED_FORMAT", message: "File content doesn't match a supported image/PDF format." };
  }
  if (detected !== opts.mime) {
    return {
      ok: false,
      error: "MIME_MISMATCH",
      message: `Header said ${opts.mime} but contents are ${detected}.`,
    };
  }

  const ext = EXT_BY_MIME[opts.mime];
  if (!ext) return { ok: false, error: "EXT_UNKNOWN" };

  const filename = randomFilename(ext);

  const s3 = readS3Config();
  if (s3) {
    try {
      await getS3Client(s3).send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: filename,
          Body: opts.buffer,
          ContentType: opts.mime,
        }),
      );
    } catch (err) {
      return { ok: false, error: "S3_PUT_FAILED", message: err instanceof Error ? err.message : String(err) };
    }
    return { ok: true, url: `/uploads/${filename}`, size: opts.buffer.length, mime: opts.mime };
  }

  // Supabase Storage — second choice, lights up automatically wherever the
  // app's Supabase env is present. POST (not PUT) so an unlikely filename
  // collision errors instead of silently overwriting someone else's file.
  const sb = readSupabaseConfig();
  if (sb) {
    try {
      const res = await fetch(`${sb.url}/storage/v1/object/${sb.bucket}/${filename}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sb.serviceKey}`,
          "Content-Type": opts.mime,
          "Cache-Control": "public, max-age=31536000, immutable", // filenames are random+unique — cache forever
        },
        body: new Uint8Array(opts.buffer),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          error: "SUPABASE_PUT_FAILED",
          message: `${uploadNoun(opts.kind)} upload failed. Please try again.`,
          deployerHint: `Supabase Storage returned ${res.status}: ${errText.slice(0, 300)}. Check the "${sb.bucket}" bucket exists and SUPABASE_SERVICE_ROLE_KEY is valid.`,
        };
      }
    } catch (err) {
      return {
        ok: false,
        error: "SUPABASE_PUT_FAILED",
        message: `${uploadNoun(opts.kind)} upload failed. Please try again.`,
        deployerHint: `Supabase Storage network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return { ok: true, url: `/uploads/${filename}`, size: opts.buffer.length, mime: opts.mime };
  }

  // Local-filesystem fallback. Works in dev (writable cwd) and on most VMs.
  // Vercel's serverless runtime has a read-only filesystem under public/, so
  // this branch will EROFS — surface a clear "configure storage" error rather
  // than an unhandled 500. The S3_* or Supabase env vars above light up the
  // remote branches.
  try {
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), opts.buffer);
    return { ok: true, url: `/uploads/${filename}`, size: opts.buffer.length, mime: opts.mime };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Vercel's read-only FS yields EROFS / ENOENT under /public.
    const isReadOnly = /EROFS|ENOENT|EACCES|EPERM/.test(msg);
    if (isReadOnly) {
      const noun = uploadNoun(opts.kind);
      return {
        ok: false,
        error: "STORAGE_NOT_CONFIGURED",
        // User-facing. Reads naturally as a toast — never mentions env vars.
        message: `${noun} upload is temporarily unavailable. You can continue without it and add it later.`,
        // Operator-facing. Stays in the API response body for logs but no
        // toast surfaces it (callsites use data.message only).
        deployerHint:
          "File storage isn't configured. Either set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (Supabase Storage, bucket 'uploads') or S3_BUCKET / S3_ACCESS_KEY / S3_SECRET / S3_PUBLIC_URL (S3-compatible: AWS / R2 / Backblaze).",
      };
    }
    return {
      ok: false,
      error: "LOCAL_WRITE_FAILED",
      message: `${uploadNoun(opts.kind)} upload failed. Please try again.`,
      deployerHint: `Local write failed: ${msg}`,
    };
  }
}

export function isAllowedMime(kind: UploadKind, mime: string): boolean {
  return POLICY[kind]?.mimes.includes(mime) ?? false;
}

export function maxBytesFor(kind: UploadKind): number {
  return POLICY[kind]?.maxBytes ?? 0;
}
