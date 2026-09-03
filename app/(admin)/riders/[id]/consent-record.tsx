import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  INDEMNITY_TEXT,
  INDEMNITY_VERSION,
  INJURY_NOC_TEXT,
  INJURY_NOC_VERSION,
} from "@/lib/schemas/rider-onboarding";

// The signed-consent record for a rider, as captured at registration.
//
// All of this was already being stored — indemnity timestamp, the name the
// signer typed, the NOC tick, IP, user agent, version, and the DPDPA parental
// consent blob for minors. None of it was visible except a bare date. Consent
// evidence you cannot produce is not evidence, and the onboarding form tells
// the signer in as many words that their "electronic signature will be
// recorded with timestamp and IP address as legal proof of consent" — so the
// record has to be readable by a human when someone asks.
//
// HQ-only (SUPER_ADMIN / ADMIN). It carries IP and device details, which are
// personal data about a parent, and are needed for disputes rather than for
// day-to-day club work.

type ConsentJson = {
  signature?: string;
  indemnityVersion?: string;
  nocVersion?: string;
  nocAgreed?: boolean;
  agreedAt?: string;
  // Stored from the day the consent-request flow shipped, and from
  // registration only after this was fixed — older registrations kept the
  // version and threw the wording away.
  indemnityText?: string;
  nocText?: string;
};

type ParentalConsentJson = {
  signedAt?: string;
  parentName?: string;
  parentRelation?: string;
  parentPhone?: string;
  ip?: string;
  ua?: string;
  consentText?: string;
  consentVersion?: string;
};

/**
 * Date AND time, in the centre's timezone.
 *
 * The server runs UTC. formatDate() renders a bare date with no timeZone, so a
 * consent signed at 00:30 IST displayed as the previous day — on the one
 * record whose whole purpose is saying exactly when somebody agreed. The time
 * matters too: "signed before the lesson" is a different fact from "signed
 * after the fall".
 */
function stamp(d: Date | string | null | undefined, timeZone: string): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

/**
 * The wording someone actually agreed to.
 *
 * Falls back to the current text for the pinned version when the record only
 * kept a version string — accurate as long as the version still matches, and
 * labelled so nobody mistakes a reconstruction for the stored original. A
 * version number identifies wording only while someone still holds the
 * version it points at; that is why the text is now stored per rider.
 */
function AgreedWording({
  stored,
  version,
  currentText,
  currentVersion,
  label,
}: {
  stored?: string;
  version?: string | null;
  currentText: string;
  currentVersion: string;
  label: string;
}) {
  const reconstructed = !stored && version === currentVersion;
  const text = stored ?? (reconstructed ? currentText : null);
  if (!text) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        The wording for version {version ?? "—"} is not on this record and no longer matches the
        current text, so it cannot be shown. Newer signatures store their own copy.
      </p>
    );
  }
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
        Show the exact wording that was agreed — {label}
      </summary>
      <blockquote className="mt-2 whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs leading-relaxed">
        {text}
      </blockquote>
      {reconstructed && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Reproduced from the current {version} text — this record predates storing the wording
          per rider, and the version has not changed since.
        </p>
      )}
    </details>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </>
  );
}

export function ConsentRecord({
  rider,
  timeZone,
}: {
  rider: {
    indemnitySignedAt: Date | null;
    indemnitySignerIp: string | null;
    indemnitySignerUa: string | null;
    indemnityVersion: string | null;
    indemnityConsentJson: unknown;
    parentalConsentJson: unknown;
    tcsAcceptedAt: Date | null;
    tcsVersion: string | null;
    rulesAcceptedAt: Date | null;
    rulesVersion: string | null;
    createdAt: Date;
  };
  timeZone: string;
}) {
  const consent = (rider.indemnityConsentJson ?? null) as ConsentJson | null;
  const parental = (rider.parentalConsentJson ?? null) as ParentalConsentJson | null;
  const signed = Boolean(rider.indemnitySignedAt);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Consent &amp; indemnity record</CardTitle>
          <Badge variant={signed ? "success" : "destructive"}>
            {signed ? "Signed at registration" : "No signature on record"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!signed ? (
          <p className="text-sm text-muted-foreground">
            No indemnity signature was captured for this rider. That is expected for riders added
            by staff (bulk import, or created directly), since only the public registration form
            captures a signature. If this rider registered themselves, it means the record predates
            consent capture — worth collecting on paper before they next ride.
          </p>
        ) : (
          <>
            <section>
              <h3 className="mb-2 text-sm font-medium">Indemnity &amp; liability release</h3>
              <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
                <Row label="Signed at">{stamp(rider.indemnitySignedAt, timeZone)}</Row>
                <Row label="Signature typed">
                  {consent?.signature ? (
                    <span className="font-medium">{consent.signature}</span>
                  ) : (
                    <span className="text-muted-foreground">— not recorded</span>
                  )}
                </Row>
                <Row label="Agreement version">
                  <span className="font-mono text-xs">
                    {rider.indemnityVersion ?? consent?.indemnityVersion ?? "—"}
                  </span>
                </Row>
              </dl>
              <AgreedWording
                stored={consent?.indemnityText}
                version={rider.indemnityVersion ?? consent?.indemnityVersion}
                currentText={INDEMNITY_TEXT}
                currentVersion={INDEMNITY_VERSION}
                label="indemnity"
              />
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">NOC for injuries</h3>
              <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
                <Row label="Consent given">
                  {consent?.nocAgreed === true ? (
                    <Badge variant="success">Agreed</Badge>
                  ) : consent?.nocAgreed === false ? (
                    <Badge variant="destructive">Declined</Badge>
                  ) : (
                    // Riders registered before the NOC was added have no value
                    // here. Saying so is better than implying they declined.
                    <span className="text-muted-foreground">
                      Not recorded — predates the NOC step
                    </span>
                  )}
                </Row>
                <Row label="NOC version">
                  <span className="font-mono text-xs">{consent?.nocVersion ?? "—"}</span>
                </Row>
                <Row label="Agreed at">{stamp(consent?.agreedAt, timeZone)}</Row>
              </dl>
              <AgreedWording
                stored={consent?.nocText}
                version={consent?.nocVersion}
                currentText={INJURY_NOC_TEXT}
                currentVersion={INJURY_NOC_VERSION}
                label="injury NOC"
              />
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">Evidence of signature</h3>
              <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
                <Row label="IP address">
                  <span className="font-mono text-xs">{rider.indemnitySignerIp ?? "—"}</span>
                </Row>
                <Row label="Device">
                  <span className="font-mono text-xs">{rider.indemnitySignerUa ?? "—"}</span>
                </Row>
              </dl>
            </section>
          </>
        )}

        {parental && (
          <section>
            <h3 className="mb-2 text-sm font-medium">
              Parental consent{" "}
              <span className="font-normal text-muted-foreground">
                — DPDPA s.9, rider was a minor at registration
              </span>
            </h3>
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              <Row label="Consented by">{parental.parentName ?? "—"}</Row>
              <Row label="Relationship">{parental.parentRelation ?? "—"}</Row>
              <Row label="Phone">
                <span className="font-mono text-xs">{parental.parentPhone ?? "—"}</span>
              </Row>
              <Row label="Signed at">{stamp(parental.signedAt, timeZone)}</Row>
              <Row label="Consent version">
                <span className="font-mono text-xs">{parental.consentVersion ?? "—"}</span>
              </Row>
              <Row label="IP address">
                <span className="font-mono text-xs">{parental.ip ?? "—"}</span>
              </Row>
            </dl>
            {parental.consentText && (
              // The exact wording is stored per rider because it changes between
              // versions. Showing the current text instead of the agreed text
              // would misrepresent what this parent actually accepted.
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  Show the exact wording this parent agreed to
                </summary>
                <blockquote className="mt-2 whitespace-pre-wrap rounded-md border bg-muted p-3 text-xs leading-relaxed">
                  {parental.consentText}
                </blockquote>
              </details>
            )}
          </section>
        )}

        {(rider.tcsAcceptedAt || rider.rulesAcceptedAt) && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Other acceptances</h3>
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
              {rider.tcsAcceptedAt && (
                <Row label="Terms accepted">
                  {stamp(rider.tcsAcceptedAt, timeZone)}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {rider.tcsVersion ?? ""}
                  </span>
                </Row>
              )}
              {rider.rulesAcceptedAt && (
                <Row label="Club rules accepted">
                  {stamp(rider.rulesAcceptedAt, timeZone)}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {rider.rulesVersion ?? ""}
                  </span>
                </Row>
              )}
            </dl>
          </section>
        )}

        <p className="border-t pt-3 text-xs text-muted-foreground">
          Times are shown in this centre&apos;s local timezone ({timeZone}). Registration was
          created {stamp(rider.createdAt, timeZone)}. This record is visible to HQ only.
        </p>
      </CardContent>
    </Card>
  );
}
