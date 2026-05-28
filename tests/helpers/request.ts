// Test helper for constructing NextRequest objects without `as any` casts.
//
// App Router route handlers accept `NextRequest`, which is a subclass of the
// platform `Request` with extras like `nextUrl`. In tests we just want to
// hand the handler a request shape — the handler itself only uses the
// standard surface (req.json(), req.headers, req.url). Casting a `Request`
// directly to `NextRequest` confuses TypeScript; the cleanest path is to
// build a NextRequest from the same args you'd give to Request().
//
// Usage:
//   import { mockReq } from "../helpers/request";
//   const res = await POST(mockReq("http://localhost", { method: "POST", body: "{}" }));

import { NextRequest } from "next/server";

export function mockReq(url: string | URL, init?: RequestInit): NextRequest {
  // NextRequest accepts the same (url, init) signature as Request — wrap
  // in a Request first to dodge an edge case where NextRequest's overloads
  // pick the wrong constructor when init.body is a string.
  return new NextRequest(new Request(url, init));
}
