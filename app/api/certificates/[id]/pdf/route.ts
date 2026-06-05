import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { blockIfFeatureOff } from "@/lib/features-gate";
import { renderPrintable, pdfHeader, escapeHtml } from "@/lib/pdf";

// GET /api/certificates/[id]/pdf — return print-ready HTML for the cert.
// We render in the browser rather than rasterising server-side; see lib/pdf.ts
// for the rationale.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const featureBlock = await blockIfFeatureOff(session, "certificates");
  if (featureBlock) return featureBlock;

  const cert = await prisma.certificate.findUnique({
    where: { id: params.id },
    include: {
      rider: { select: { firstName: true, lastName: true } },
      centre: { select: { name: true, address: true } },
    },
  });
  if (!cert) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const issued = cert.issuedAt.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });

  const body = `
    ${pdfHeader({ centreName: cert.centre.name, subtitle: cert.centre.address ?? undefined, serial: cert.serialNo })}
    <div style="text-align:center;margin-top:30mm">
      <h3>Certificate of ${escapeHtml(cert.type === "promotion" ? "Promotion" : cert.type === "winner" ? "Achievement" : "Participation")}</h3>
      <p style="margin-top:14mm;font-size:13pt">This is to certify that</p>
      <h1 style="margin-top:6mm;font-size:32pt;color:#0f172a">
        ${escapeHtml(cert.rider.firstName)} ${escapeHtml(cert.rider.lastName)}
      </h1>
      <p style="margin-top:10mm;font-size:13pt">has successfully ${cert.type === "promotion" ? "been promoted to" : cert.type === "winner" ? "achieved" : "completed"}</p>
      <h2 style="margin-top:6mm">${escapeHtml(cert.levelName ?? "—")}</h2>
      <p style="margin-top:6mm;color:#555">Issued on ${issued}</p>
    </div>
    <div class="signature-block" style="margin-top:30mm">
      <div>Examiner</div>
      <div>Centre Head</div>
    </div>
    <div class="footer">
      <span>Cert # ${escapeHtml(cert.serialNo)}</span>
      <span>Verify: /verify/${escapeHtml(cert.serialNo)}</span>
    </div>
  `;

  const html = renderPrintable({
    title: `Certificate ${cert.serialNo}`,
    bodyHtml: body,
    autoPrint: false,
  });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
