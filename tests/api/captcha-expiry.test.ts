// Why a parent filling the rider onboarding form got "that verification answer
// wasn't right" while typing the correct answer.
//
// The challenge is rendered on the indemnity step — a scrollable legal
// release, a NOC, a typed signature and two tick-boxes. It carried a 5-minute
// TTL, so a parent who actually read the thing ran out of clock, and expiry
// was reported with the same wording as a wrong answer. These assert the two
// properties that stop that recurring: the window fits the form, and the two
// failures are told apart.

import { describe, it, expect, vi, afterEach } from "vitest";
import { issueChallenge, verifyChallengeDetailed, captchaMessage } from "@/lib/captcha";

/** Recover the expected answer from the token so the test can be correct. */
function solve(token: string): string {
  const payload = Buffer.from(token.split(".")[0], "base64url").toString("utf8");
  return payload.split("|")[1];
}

afterEach(() => vi.useRealTimers());

describe("challenge lifetime", () => {
  it("survives a parent spending 20 minutes on the indemnity step", () => {
    const { token } = issueChallenge();
    const answer = solve(token);
    vi.useFakeTimers();
    vi.advanceTimersByTime(20 * 60_000);
    // This is the exact case that was failing in production.
    expect(verifyChallengeDetailed(token, answer).ok).toBe(true);
  });

  it("outlives a parent who leaves the tab open and comes back", () => {
    // The case that actually happened, twice. 5 minutes was blown through by
    // someone reading the indemnity; 30 minutes was still hit by a real
    // applicant on his second attempt. Both were guesses at how long a form
    // "should" take, which is the wrong question — people get interrupted.
    const { token } = issueChallenge();
    const answer = solve(token);
    vi.useFakeTimers();
    vi.advanceTimersByTime(6 * 60 * 60_000);
    expect(verifyChallengeDetailed(token, answer).ok).toBe(true);
  });

  it("still expires eventually", () => {
    const { token } = issueChallenge();
    const answer = solve(token);
    vi.useFakeTimers();
    vi.advanceTimersByTime(13 * 60 * 60_000);
    const r = verifyChallengeDetailed(token, answer);
    expect(r).toEqual({ ok: false, reason: "expired" });
  });
});

describe("failures are distinguishable", () => {
  it("separates an expired challenge from a wrong answer", () => {
    const { token } = issueChallenge();
    const answer = solve(token);

    const wrong = verifyChallengeDetailed(token, String(Number(answer) + 1));
    expect(wrong).toEqual({ ok: false, reason: "wrong" });

    vi.useFakeTimers();
    vi.advanceTimersByTime(13 * 60 * 60_000);
    expect(verifyChallengeDetailed(token, answer)).toEqual({ ok: false, reason: "expired" });
  });

  it("does not blame the user's arithmetic for our clock", () => {
    // The bug was not the rejection, it was the wording: a parent was told
    // their correct answer was wrong, so they retried the same way and failed
    // the same way.
    expect(captchaMessage("expired")).not.toEqual(captchaMessage("wrong"));
    expect(captchaMessage("expired")).toMatch(/expired/i);
    expect(captchaMessage("expired")).toMatch(/still here/i);
  });

  it("rejects a forged or tampered token as malformed", () => {
    const { token } = issueChallenge();
    const [encoded] = token.split(".");
    // Re-sign a payload claiming answer 0 with a bogus signature.
    const forged = `${encoded}.${"0".repeat(64)}`;
    expect(verifyChallengeDetailed(forged, solve(token))).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyChallengeDetailed("garbage", "9").ok).toBe(false);
    expect(verifyChallengeDetailed("", "9").ok).toBe(false);
  });

  it("accepts a padded answer, because people type spaces", () => {
    const { token } = issueChallenge();
    expect(verifyChallengeDetailed(token, `  ${solve(token)} `).ok).toBe(true);
  });
});
