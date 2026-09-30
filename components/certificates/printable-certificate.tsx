import { qrSvg, verifyUrl } from "@/lib/cert";
import { PLATFORM_TZ } from "@/lib/tz";

// The printable certificate itself — one A4 page. Used by the single print
// view and by bulk printing (a sitting's, an exam day's or a batch's passes),
// so a certificate looks the same however it was printed.
export type PrintableCert = {
  type: string;
  serialNo: string;
  levelName: string | null;
  issuedAt: Date;
  revokedAt: Date | null;
  centre: { name: string; address: string | null; org: { name: string } };
  rider: { firstName: string; lastName: string; currentLevel: string | null };
  exam: { date: Date; level: number } | null;
};

export async function PrintableCertificate({ cert, signerName }: { cert: PrintableCert; signerName: string | null }) {
  const issuedDate = new Date(cert.issuedAt).toLocaleDateString("en-IN", {
    timeZone: PLATFORM_TZ,
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const occasion =
    cert.type === "promotion" && cert.exam
      ? `Level ${cert.exam.level} promotion · ${new Date(cert.exam.date).toLocaleDateString("en-IN", { timeZone: PLATFORM_TZ, day: "2-digit", month: "long", year: "numeric" })}`
      : null;
  const verifyHref = verifyUrl(cert.serialNo);
  const qr = await qrSvg(verifyHref, { size: 160 });
  const signer = signerName ? { name: signerName } : null;

  return (
      <div className="cert-page relative border-[6px] border-double border-amber-700/60 px-12 py-16 text-center">
      {/* Top crest band */}
      <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-warning-foreground">
        {cert.centre.org.name}
      </div>
      <div className="mt-1 text-[14px] text-slate-600">{cert.centre.name}</div>

      {/* Title */}
      <h1 className="mt-12 font-serif text-5xl tracking-wide">
        {cert.type === "winner"
          ? "Certificate of Excellence"
          : cert.type === "promotion"
            ? "Certificate of Promotion"
            : cert.type === "participation"
              ? "Certificate of Participation"
              : "Certificate of Attendance"}
      </h1>

      <div className="mx-auto mt-8 h-px w-32 bg-amber-700/50" />

      <p className="mt-10 text-sm uppercase tracking-widest text-slate-500">presented to</p>
      <p className="mt-3 font-serif text-4xl">
        {cert.rider.firstName} {cert.rider.lastName}
      </p>

      <p className="mx-auto mt-10 max-w-md text-sm leading-7 text-slate-700">
        {cert.type === "promotion" ? (
          <>
            In recognition of successful promotion to <strong>{cert.levelName ?? cert.rider.currentLevel ?? "—"}</strong>{" "}
            after passing the formal examination.
          </>
        ) : cert.type === "winner" ? (
          <>
            In recognition of placing <strong>{cert.levelName ?? ""}</strong>.
          </>
        ) : cert.type === "participation" ? (
          <>
            For participating{cert.levelName ? <> in <strong>{cert.levelName}</strong></> : null}.
          </>
        ) : (
          <>For attending the event.</>
        )}
      </p>

      {occasion && (
        <p className="mt-4 text-xs italic text-slate-500">{occasion}</p>
      )}

      {/* Footer block */}
      <div className="mt-16 flex items-end justify-between">
        <div className="text-left">
          <div className="h-px w-40 bg-slate-400" />
          <div className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">Issued by</div>
          <div className="text-sm font-medium">{signer?.name ?? cert.centre.name}</div>
          <div className="text-[10px] text-slate-500">{issuedDate}</div>
        </div>

        <div className="text-center">
          <div
            className="mx-auto h-[120px] w-[120px]"
            dangerouslySetInnerHTML={{ __html: qr }}
            aria-label={`QR code for verifying ${cert.serialNo}`}
          />
          <div className="mt-1 font-mono text-[10px] text-slate-500">{cert.serialNo}</div>
          <div className="text-[9px] text-slate-400">Scan to verify</div>
        </div>

        <div className="text-right">
          <div className="ml-auto h-px w-40 bg-slate-400" />
          <div className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">Authorised signatory</div>
          <div className="text-sm font-medium">{cert.centre.name}</div>
          <div className="text-[10px] text-slate-500">{cert.centre.address ?? ""}</div>
        </div>
      </div>

      {cert.revokedAt && (
        <div className="absolute inset-0 flex items-center justify-center bg-danger-soft">
          <div className="rotate-[-15deg] border-4 border-rose-700 px-12 py-4 font-serif text-5xl font-bold uppercase tracking-widest text-danger-foreground/80">
            Revoked
          </div>
        </div>
      )}
    </div>
  );
}
