import QRCode from "qrcode";
import { prisma } from "./prisma";

// Serial format: EW-L{level}-{8 base32 chars, no ambiguous}. Globally unique.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function randomChunk(n: number): string {
  let out = "";
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

export async function generateUniqueSerial(level: number): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const candidate = `EW-L${level}-${randomChunk(8)}`;
    const existing = await prisma.certificate.findUnique({ where: { serialNo: candidate } });
    if (!existing) return candidate;
  }
  throw new Error("Could not allocate unique certificate serial after 8 attempts");
}

export function verifyUrl(serial: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  return `${base}/verify/${serial}`;
}

// Returns inline SVG string. Safe to embed via dangerouslySetInnerHTML — input is our own URL.
export async function qrSvg(text: string, opts: { size?: number; margin?: number } = {}): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: opts.margin ?? 1,
    width: opts.size ?? 192,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172a", light: "#ffffff" },
  });
}
