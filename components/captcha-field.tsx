"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CaptchaValue = { captchaToken: string; captchaAnswer: string };

export const EMPTY_CAPTCHA: CaptchaValue = { captchaToken: "", captchaAnswer: "" };

// The client half of lib/captcha.ts.
//
// The server half already existed and was already enforced — but nothing ever
// rendered it, so /api/auth/forgot-password (which hard-requires a solved
// challenge in production) silently returned its no-enumeration 200 and sent no
// email. Password reset was dead in production and looked like it worked.
//
// `refreshKey` is how a parent asks for a new question: a challenge is
// single-shot and 5-minute-lived, so a rejected submit needs a fresh one.
// Bump the key and both the question and the token reload together — which is
// why the question can't live in the parent.
export function CaptchaField({
  value,
  onChange,
  disabled,
  refreshKey = 0,
}: {
  value: CaptchaValue;
  onChange: (v: CaptchaValue) => void;
  disabled?: boolean;
  refreshKey?: number;
}) {
  const [question, setQuestion] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Local nudge for the retry link, added to refreshKey.
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFailed(false);
      setQuestion(null);
      try {
        const res = await fetch("/api/captcha", { cache: "no-store" });
        if (!res.ok) throw new Error("captcha");
        const data = (await res.json()) as { question: string; token: string };
        if (cancelled) return;
        setQuestion(data.question);
        onChange({ captchaToken: data.token, captchaAnswer: "" });
      } catch {
        if (cancelled) return;
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // onChange is rebuilt on every parent render; depending on it would fetch a
    // new challenge on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, retry]);

  if (failed) {
    return (
      <p className="text-xs text-destructive">
        Couldn&apos;t load the verification question.{" "}
        <button type="button" onClick={() => setRetry((n) => n + 1)} className="underline">
          Try again
        </button>
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="captcha-answer">Quick check: what is {question ?? "…"}?</Label>
      <Input
        id="captcha-answer"
        inputMode="numeric"
        autoComplete="off"
        required
        disabled={disabled || !question}
        value={value.captchaAnswer}
        onChange={(e) => onChange({ ...value, captchaAnswer: e.target.value })}
        placeholder="Answer"
      />
    </div>
  );
}
