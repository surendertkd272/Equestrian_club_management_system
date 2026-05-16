// Tiny in-process rate limiter — keys → sliding-window timestamps.
//
// Good enough for one-instance deployments (single Node process). For
// multi-instance / serverless prod, swap this for Redis + INCR/EXPIRE.
// The interface stays the same so the swap is a one-file change.
//
// Used by /api/auth/login + forgot-password to slow brute force. Keyed
// on (route, ip + email) so an attacker has to spread across both axes
// to evade the cap.

const buckets = new Map<string, number[]>();

export function checkRate(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= limit) {
    const oldest = hits[0]!;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  // Gentle pruning — drops fully expired keys periodically. O(n) but rare.
  if (buckets.size > 5000) {
    for (const [k, ts] of buckets) {
      if (ts.every((t) => t < cutoff)) buckets.delete(k);
    }
  }
  return { ok: true };
}

// Derives a request-fingerprint string (forwarded-IP if present, else
// the User-Agent fallback). NOT a security primitive on its own — combine
// with another axis (e.g. email) for sensible rate keys.
export function clientFingerprint(req: Request): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  return ip;
}
