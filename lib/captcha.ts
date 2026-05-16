// Minimal math-CAPTCHA. No external provider (reCAPTCHA / hCaptcha)
// dependency. The server issues a question + a short-lived signed token
// that encodes the expected answer; the client posts back the answer +
// the token. We verify the HMAC + the answer + the expiry.
//
// Trade-off: math captcha is solvable by determined bots, but at least
// pushes the cost above "trivial". Enough to slow signup/abuse without
// forcing every legit user through Google's reCAPTCHA dance. If you
// outgrow it, swap this module's two exports for hCaptcha calls — the
// route surface stays the same.

import crypto from "node:crypto";

const TTL_MS = 5 * 60 * 1000; // 5 min — fits the slowest human onboarding form

function secret(): string {
  // Reuse JWT_SECRET — captcha is short-lived and using a separate
  // secret would just be more env to manage.
  const s = process.env.JWT_SECRET ?? "dev-captcha-secret";
  return s;
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

// Q&A pairs. We generate easy questions because the goal is "bot-slowing",
// not "Mensa entrance test" — pick from small additions/subtractions a
// child could solve in a second.
function newQuestion(): { question: string; answer: number } {
  const a = Math.floor(Math.random() * 9) + 1; // 1..9
  const b = Math.floor(Math.random() * 9) + 1;
  // 60/40 split add vs subtract; subtract guaranteed non-negative.
  if (Math.random() < 0.6 || b > a) {
    return { question: `${a} + ${b}`, answer: a + b };
  }
  return { question: `${a} − ${b}`, answer: a - b };
}

export function issueChallenge(): { question: string; token: string } {
  const { question, answer } = newQuestion();
  const expiresAt = Date.now() + TTL_MS;
  const payload = `${question}|${answer}|${expiresAt}`;
  const token = `${Buffer.from(payload).toString("base64url")}.${hmac(payload)}`;
  return { question, token };
}

export function verifyChallenge(token: string, answer: string | number): boolean {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return false;
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  if (hmac(payload) !== sig) return false;
  const [, expected, expiresAtStr] = payload.split("|");
  if (!expected || !expiresAtStr) return false;
  if (Date.now() > Number(expiresAtStr)) return false;
  return String(answer).trim() === expected;
}
