import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAllowedMime, maxBytesFor, uploadFile } from "./storage";

describe("isAllowedMime", () => {
  it("accepts whitelisted MIMEs per kind", () => {
    expect(isAllowedMime("rider_photo", "image/jpeg")).toBe(true);
    expect(isAllowedMime("rider_photo", "image/png")).toBe(true);
    expect(isAllowedMime("rider_aadhaar", "application/pdf")).toBe(true);
    expect(isAllowedMime("rider_indemnity", "application/pdf")).toBe(true);
  });
  it("rejects MIMEs outside the per-kind whitelist", () => {
    // PDFs not allowed for rider photos.
    expect(isAllowedMime("rider_photo", "application/pdf")).toBe(false);
    // WebP not allowed for Aadhaar (only jpg/png/pdf).
    expect(isAllowedMime("rider_aadhaar", "image/webp")).toBe(false);
  });
  it("rejects unknown kinds without throwing", () => {
    // @ts-expect-error — intentionally bad kind
    expect(isAllowedMime("not_a_kind", "image/jpeg")).toBe(false);
  });
});

describe("maxBytesFor", () => {
  it("returns 5MB for every defined kind", () => {
    const fiveMB = 5 * 1024 * 1024;
    expect(maxBytesFor("rider_photo")).toBe(fiveMB);
    expect(maxBytesFor("rider_aadhaar")).toBe(fiveMB);
    expect(maxBytesFor("rider_indemnity")).toBe(fiveMB);
    expect(maxBytesFor("horse_photo")).toBe(fiveMB);
    expect(maxBytesFor("asset_photo")).toBe(fiveMB);
    expect(maxBytesFor("generic")).toBe(fiveMB);
  });
  it("returns 0 for unknown kind", () => {
    // @ts-expect-error — intentionally bad kind
    expect(maxBytesFor("not_a_kind")).toBe(0);
  });
});

describe("uploadFile validation (early-return, no I/O)", () => {
  // Pin the env so the S3 branch never engages — pure local-fs validation paths.
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET;
    delete process.env.S3_PUBLIC_URL;
  });
  afterEach(() => {
    process.env = saved;
  });

  it("rejects unknown kind", async () => {
    const res = await uploadFile({
      // @ts-expect-error — intentionally bad
      kind: "not_a_kind",
      buffer: Buffer.from([0]),
      mime: "image/jpeg",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("INVALID_KIND");
  });

  it("rejects disallowed MIME for kind", async () => {
    const res = await uploadFile({
      kind: "rider_photo",
      buffer: Buffer.from([0]),
      mime: "application/pdf", // not in rider_photo whitelist
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("MIME_NOT_ALLOWED");
  });

  it("rejects oversize uploads", async () => {
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1);
    const res = await uploadFile({ kind: "rider_photo", buffer: tooBig, mime: "image/jpeg" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("TOO_LARGE");
  });

  it("rejects empty buffers", async () => {
    const res = await uploadFile({
      kind: "rider_photo",
      buffer: Buffer.alloc(0),
      mime: "image/jpeg",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("EMPTY");
  });
});
