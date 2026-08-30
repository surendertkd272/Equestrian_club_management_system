import { describe, it, expect, afterEach } from "vitest";
import { verifyUrl, qrSvg } from "./cert";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("verifyUrl", () => {
  it("builds an absolute URL when NEXT_PUBLIC_APP_URL is set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://equiwings.in";
    expect(verifyUrl("EW-L1-ABCDEFGH")).toBe("https://equiwings.in/verify/EW-L1-ABCDEFGH");
  });
  it("strips a trailing slash from the base URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://equiwings.in/";
    expect(verifyUrl("EW-L1-ABCDEFGH")).toBe("https://equiwings.in/verify/EW-L1-ABCDEFGH");
  });
  it("REFUSES to build a relative path when base is unset", () => {
    // This string is persisted as Certificate.qrCode and encoded into the QR
    // printed on the certificate. "/verify/X" there is a permanently dead QR
    // on a document handed to a rider, and re-rendering later cannot fix it
    // because the broken value was already stored. Throwing at issue time is
    // recoverable; fifty unscannable certificates are not.
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.APP_BASE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(() => verifyUrl("EW-L1-ABCDEFGH")).toThrow(/base URL/i);
  });

  it("falls back to APP_BASE_URL, then the Vercel production URL", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.APP_BASE_URL = "https://cms.example.in";
    expect(verifyUrl("EW-L1-ABCDEFGH")).toBe("https://cms.example.in/verify/EW-L1-ABCDEFGH");

    delete process.env.APP_BASE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "cms.vercel.app";
    expect(verifyUrl("EW-L1-ABCDEFGH")).toBe("https://cms.vercel.app/verify/EW-L1-ABCDEFGH");
  });
});

describe("qrSvg", () => {
  it("returns an inline SVG string for given text", async () => {
    const svg = await qrSvg("https://example.com/verify/EW-L1-ABCDEFGH");
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain("</svg>");
  });
  it("honours custom size", async () => {
    const svg = await qrSvg("hello", { size: 256 });
    expect(svg).toMatch(/width="256"/);
  });
  it("honours custom margin", async () => {
    // Both margins should render — sanity-check the call doesn't throw with options.
    await expect(qrSvg("hello", { margin: 4 })).resolves.toMatch(/^<svg /);
  });
});
