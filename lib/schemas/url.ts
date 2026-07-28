import { z } from "zod";

// Shared validator for any URL a user supplies that we later store and render
// into an <a href> or an <img src>.
//
// Two bugs kept recurring, in opposite directions, because each schema rolled
// its own rule:
//
//   • `z.string().url()` REJECTS the relative "/uploads/<file>" path that
//     /api/upload actually returns, so attaching a document silently failed
//     with a bare VALIDATION error (hit on Add Staff, and on exam attachments).
//   • A bare `z.string()` ACCEPTS "javascript:alert(...)", which then renders
//     as a live link for the next person who opens the record. Our CSP allows
//     'unsafe-inline', so those URLs execute.
//
// This accepts exactly what the product legitimately produces — our own upload
// path, or an ordinary http(s) link — and nothing else. Reach for this instead
// of `z.string().url()` whenever the value ends up in an href or src.

const UPLOADS_PATH = /^\/uploads\/[a-z0-9._-]+$/i;

export function isSafeStoredUrl(u: string): boolean {
  if (UPLOADS_PATH.test(u)) return true;
  try {
    const proto = new URL(u).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
}

const MESSAGE = "Must be an /uploads/ path from our upload endpoint, or an http(s) link";

/** Required safe URL. */
export const storedUrl = z.string().max(1000).refine(isSafeStoredUrl, MESSAGE);

/** Optional safe URL that also tolerates the empty string a cleared input submits. */
export const optionalStoredUrl = storedUrl.optional().or(z.literal(""));
