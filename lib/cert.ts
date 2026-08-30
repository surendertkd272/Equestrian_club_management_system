import QRCode from "qrcode";
import { prisma } from "./prisma";
import { absoluteUrl } from "./absolute-url";

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

/**
 * Public verification URL for a certificate serial.
 *
 * THROWS when no base URL is configured, rather than returning "/verify/X".
 *
 * This value is not just rendered — it is PERSISTED as Certificate.qrCode and
 * encoded into the QR printed on the certificate. A relative path there is a
 * permanently dead QR code on a document handed to a rider, and re-rendering
 * later does not fix it because the broken string was already stored. Failing
 * at issue time is recoverable; printing fifty unscannable certificates is not.
 */
export function verifyUrl(serial: string): string {
  return absoluteUrl(`/verify/${serial}`);
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
