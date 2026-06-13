import { vi } from "vitest";

// React's `cache()` is provided by the Next.js server runtime (Next aliases
// `react` to its own build for RSC). Under vitest we get plain `react`
// (18.3.1), where `cache` is undefined — so importing anything from lib/auth.ts
// (which does `export const getSession = cache(...)`) throws "cache is not a
// function", which silently kills EVERY auth-importing integration test.
//
// Provide a pass-through `cache` (no per-request memoisation needed in tests —
// it only dedupes DB reads within one request; correctness is unchanged).
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: typeof (actual as { cache?: unknown }).cache === "function"
      ? (actual as { cache: <T>(fn: T) => T }).cache
      : (<T>(fn: T): T => fn),
  };
});
