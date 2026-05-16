// Validates a `next=` query parameter is a same-origin relative path before
// honouring it as a redirect target. Without this check, /login?next=
// https://evil.com would phish the user post-auth.
//
// Rules:
//   • Must start with a single "/" — no protocol-relative URLs ("//evil")
//   • No backslashes (some browsers normalise "/\evil.com" to a host)
//   • No newlines / control chars
//   • Length cap (long pasted URLs are suspicious + slow to render)
// Anything that fails returns the fallback.

export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (typeof raw !== "string") return fallback;
  if (raw.length > 500) return fallback;
  if (raw.includes("\\")) return fallback;
  if (/[\r\n\t]/.test(raw)) return fallback;
  // Allow "/something" but reject "//other.com" or "/\foo".
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  return raw;
}
