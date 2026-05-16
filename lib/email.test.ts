import { describe, it, expect } from "vitest";
import { isValidEmail, renderEmail } from "./email";

describe("isValidEmail", () => {
  it("accepts well-formed addresses", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co.in")).toBe(true);
    expect(isValidEmail("  user@example.com  ")).toBe(true); // trims
  });
  it("rejects malformed addresses", () => {
    expect(isValidEmail("notanemail")).toBe(false);
    expect(isValidEmail("user@")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("user@example")).toBe(false); // no TLD
    expect(isValidEmail("user @example.com")).toBe(false); // space
  });
  it("rejects nullish / empty input", () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("renderEmail", () => {
  it("returns a complete HTML document", () => {
    const html = renderEmail({ heading: "Hello", body: "<p>World</p>" });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("</html>");
    expect(html).toContain("Hello");
    expect(html).toContain("<p>World</p>");
  });
  it("uses centreName when supplied, defaults to 'Equiwings'", () => {
    expect(renderEmail({ heading: "h", body: "b", centreName: "Ghaziabad HRC" })).toContain("Ghaziabad HRC");
    expect(renderEmail({ heading: "h", body: "b" })).toContain("Equiwings");
  });
  it("includes a CTA button when both ctaText and ctaUrl are supplied", () => {
    const html = renderEmail({
      heading: "h",
      body: "b",
      ctaText: "Open invoice",
      ctaUrl: "https://example.com/i/1",
    });
    expect(html).toContain("Open invoice");
    expect(html).toContain(`href="https://example.com/i/1"`);
  });
  it("omits the CTA block when either ctaText or ctaUrl is missing", () => {
    const noText = renderEmail({ heading: "h", body: "b", ctaUrl: "https://x.test" });
    const noUrl = renderEmail({ heading: "h", body: "b", ctaText: "Click" });
    expect(noText).not.toContain("href=\"https://x.test\"");
    expect(noUrl).not.toContain("Click</a>");
  });
});
