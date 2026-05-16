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
  it("falls back to a relative path when base is unset", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(verifyUrl("EW-L1-ABCDEFGH")).toBe("/verify/EW-L1-ABCDEFGH");
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
