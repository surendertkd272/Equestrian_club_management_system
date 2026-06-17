"use client";

// Client-side fetch wrapper that NEVER throws and NEVER hangs a spinner.
// A dropped connection (common on barn wifi) rejects fetch(); without this,
// callers that do `await fetch(); setSaving(false)` skip the reset and the
// button spins forever. Here every path resolves to a typed result, and !ok
// responses are turned into plain-English messages via humanizeError().
//
//   const res = await postJson("/api/horses", payload);
//   if (!res.ok) { toast.error(res.message); return; }
//   router.push(`/horses/${res.data.id}`);

import { humanizeError } from "@/lib/error-messages";

export type JsonResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; data: unknown; status: number; code?: string; message: string };

export async function sendJson<T = unknown>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
  init?: RequestInit,
): Promise<JsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...init,
    });
  } catch {
    // Network-level failure (offline, DNS, aborted) — fetch rejected.
    return {
      ok: false,
      data: null,
      status: 0,
      message: "Couldn't reach the server — check your connection and try again.",
    };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = (data as { error?: string; code?: string })?.error ?? (data as { code?: string })?.code;
    return { ok: false, data, status: res.status, code, message: humanizeError(data) };
  }
  return { ok: true, data: data as T, status: res.status };
}

export const postJson = <T = unknown>(url: string, body?: unknown, init?: RequestInit) =>
  sendJson<T>("POST", url, body, init);
export const patchJson = <T = unknown>(url: string, body?: unknown, init?: RequestInit) =>
  sendJson<T>("PATCH", url, body, init);
export const deleteJson = <T = unknown>(url: string, body?: unknown, init?: RequestInit) =>
  sendJson<T>("DELETE", url, body, init);
