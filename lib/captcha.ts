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

// The challenge must outlive the FORM it sits on, not the moment of typing.
// It was 5 minutes, and on the rider onboarding wizard it is rendered on the
// indemnity step — a scrollable wall of legal text, a NOC, a typed signature
// and two tick-boxes. A parent reading that properly takes longer than five
// minutes, so the token expired while they read and the submit was rejected
// with "that answer wasn't right" — blaming their arithmetic for our clock.
// The anti-bot value comes from requiring a solved challenge at all, not from
// a tight window; a script solves this in milliseconds either way.
const TTL_MS = 30 * 60 * 1000;

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

export type CaptchaFailure = "malformed" | "expired" | "wrong";

/**
 * Verify a challenge, saying WHY it failed.
 *
 * Expiry and a wrong answer are different events and deserve different words:
 * one is the user's mistake, the other is ours. Collapsing them into `false`
 * is what produced a misleading error on a live parent-facing form.
 */
export function verifyChallengeDetailed(
  token: string,
  answer: string | number,
): { ok: true } | { ok: false; reason: CaptchaFailure } {
  if (typeof token !== "string" || !token.includes(".")) return { ok: false, reason: "malformed" };
  const [encoded, sig] = token.split(".");
  if (!encoded || !sig) return { ok: false, reason: "malformed" };
  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  // Constant-time compare: the signature is the only thing standing between a
  // guessed payload and a forged "answer".
  const expectedSig = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "malformed" };
  }
  const [, expected, expiresAtStr] = payload.split("|");
  if (!expected || !expiresAtStr) return { ok: false, reason: "malformed" };
  if (Date.now() > Number(expiresAtStr)) return { ok: false, reason: "expired" };
  if (String(answer).trim() !== expected) return { ok: false, reason: "wrong" };
  return { ok: true };
}

export function verifyChallenge(token: string, answer: string | number): boolean {
  return verifyChallengeDetailed(token, answer).ok;
}

/** Wording that tells the truth about which of the two things went wrong. */
export function captchaMessage(reason: CaptchaFailure): string {
  return reason === "expired"
    ? "This form was open a while, so the verification check expired. Here's a new question — your answers below are all still here."
    : "That verification answer wasn't right — please try the new question.";
}
