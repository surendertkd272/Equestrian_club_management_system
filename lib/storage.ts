// File storage abstraction. Two backends — chosen at request time based on env config:
//   - S3 (or any S3-compatible: AWS S3, Cloudflare R2, DigitalOcean Spaces) when S3_BUCKET +
//     S3_ACCESS_KEY + S3_SECRET + S3_PUBLIC_URL are all set.
//   - Local filesystem (public/uploads/<filename>) as the dev fallback otherwise.
//
// Both backends return the same URL shape: `/uploads/<filename>`. In S3 mode, the
// `/uploads/:path*` rewrite in next.config.mjs forwards reads to `${S3_PUBLIC_URL}/:path*`,
// so DB rows stay portable across backends and bucket migrations (rebind S3_PUBLIC_URL
// without touching stored URLs).

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
  expense_invoice:           { mimes: ["image/jpeg", "image/png", "application/pdf"], maxBytes: 10 * 1024 * 1024 },
  generic:                   { mimes: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 5 * 1024 * 1024 },
};

export type UploadResult =
  | { ok: true; url: string; size: number; mime: string }
  | { ok: false; error: string; message?: string };

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

  // Local-filesystem fallback. Works in dev (writable cwd) and on most VMs.
  // Vercel's serverless runtime has a read-only filesystem under public/, so
  // this branch will EROFS — surface a clear "configure S3 / Vercel Blob"
  // error rather than an unhandled 500.
  try {
    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), opts.buffer);
    return { ok: true, url: `/uploads/${filename}`, size: opts.buffer.length, mime: opts.mime };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Vercel's read-only FS yields EROFS / ENOENT under /public — recognise
    // those and explain what the deployer needs to do.
    const isReadOnly = /EROFS|ENOENT|EACCES|EPERM/.test(msg);
    return {
      ok: false,
      error: isReadOnly ? "STORAGE_NOT_CONFIGURED" : "LOCAL_WRITE_FAILED",
      message: isReadOnly
        ? "File storage isn't configured. Set S3_BUCKET / S3_ACCESS_KEY / S3_SECRET / S3_PUBLIC_URL env vars for S3-compatible storage (AWS / R2 / Backblaze)."
        : `Local write failed: ${msg}`,
    };
  }
}

export function isAllowedMime(kind: UploadKind, mime: string): boolean {
  return POLICY[kind]?.mimes.includes(mime) ?? false;
}

export function maxBytesFor(kind: UploadKind): number {
  return POLICY[kind]?.maxBytes ?? 0;
}
