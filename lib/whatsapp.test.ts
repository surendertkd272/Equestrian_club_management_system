import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Stop ./audit from importing prisma — these tests only care about the dispatch logic.
vi.mock("./audit", () => ({ audit: vi.fn(async () => {}) }));

import { isWhatsAppConfigured, sendWhatsApp } from "./whatsapp";

const saved = { ...process.env };

beforeEach(() => {
  // Reset env between tests so dry-run vs configured branches are isolated.
  process.env = { ...saved };
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  vi.restoreAllMocks();
});

afterEach(() => {
  process.env = { ...saved };
});

describe("isWhatsAppConfigured", () => {
  it("true when both env vars are set", () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    expect(isWhatsAppConfigured()).toBe(true);
  });
  it("false when either is missing", () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
    expect(isWhatsAppConfigured()).toBe(false);
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    expect(isWhatsAppConfigured()).toBe(false);
  });
});

describe("sendWhatsApp", () => {
  const baseTemplate = {
    name: "ew_payment_received",
    bodyParams: ["Rider X", "₹3,000", "12345678"],
  };

  it("returns INVALID_PHONE for unrecognisable phone numbers (no fetch)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await sendWhatsApp({ to: "not-a-phone", template: baseTemplate });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("INVALID_PHONE");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dry-run when env unset: skipped:true and no fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await sendWhatsApp({ to: "9876543210", template: baseTemplate });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.skipped).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a template request to Meta and returns the message id on 200", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone_123";
    process.env.WHATSAPP_ACCESS_TOKEN = "token_abc";

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ messages: [{ id: "wamid.xyz" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendWhatsApp({ to: "9876543210", template: baseTemplate });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.messageId).toBe("wamid.xyz");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/phone_123/messages");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token_abc");

    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.to).toBe("919876543210"); // E.164 sans the leading +, per Meta
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("ew_payment_received");
    expect(body.template.language.code).toBe("en");
    expect(body.template.components[0].parameters.map((p: any) => p.text)).toEqual([
      "Rider X",
      "₹3,000",
      "12345678",
    ]);
  });

  it("honours custom template.language", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone_123";
    process.env.WHATSAPP_ACCESS_TOKEN = "token_abc";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ messages: [{ id: "x" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendWhatsApp({
      to: "9876543210",
      template: { ...baseTemplate, language: "en_GB" },
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.template.language.code).toBe("en_GB");
  });

  it("upstream non-ok response surfaces META_<status>", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone_123";
    process.env.WHATSAPP_ACCESS_TOKEN = "token_abc";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad token", { status: 401 })));

    const res = await sendWhatsApp({ to: "9876543210", template: baseTemplate });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("META_401");
  });

  it("network error surfaces NETWORK without throwing", async () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone_123";
    process.env.WHATSAPP_ACCESS_TOKEN = "token_abc";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const res = await sendWhatsApp({ to: "9876543210", template: baseTemplate });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("NETWORK");
  });
});
