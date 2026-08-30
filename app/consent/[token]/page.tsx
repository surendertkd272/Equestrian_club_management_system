import { findLiveRequest } from "@/lib/rider-consent-request";
import {
  INDEMNITY_TEXT,
  INDEMNITY_VERSION,
  INJURY_NOC_TEXT,
  INJURY_NOC_VERSION,
} from "@/lib/schemas/rider-onboarding";
import { ConsentSignForm } from "./form";

export const dynamic = "force-dynamic";

// Public signing page for an emailed consent request.
//
// Deliberately spare. The recipient is a parent on a phone who was asked to do
// one thing; anything that isn't the agreement text or the signature box is in
// the way. No navigation, no login prompt, no club chrome to get lost in.

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="mt-3 text-sm text-muted-foreground">{children}</div>
    </main>
  );
}

export default async function ConsentPage({ params }: { params: { token: string } }) {
  const request = await findLiveRequest(params.token);

  if (!request) {
    return (
      <Shell title="This link isn't valid">
        <p>
          It may have been mistyped or already replaced. Please ask the centre to send you a new
          one — nothing has been lost.
        </p>
      </Shell>
    );
  }

  const riderName = `${request.rider.firstName} ${request.rider.lastName}`;

  if (request.state === "already_signed") {
    return (
      <Shell title="Already signed — nothing more to do">
        <p>
          The indemnity for <strong>{riderName}</strong> was signed on{" "}
          {request.signedAt?.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
          . You can close this page.
        </p>
      </Shell>
    );
  }

  if (request.state === "expired") {
    return (
      <Shell title="This link has expired">
        <p>
          Links stay valid for 30 days. Please ask {request.centre.name} to send a fresh one for{" "}
          <strong>{riderName}</strong>.
        </p>
      </Shell>
    );
  }

  // Age at today, to word the signature line correctly. A parent signing for a
  // child should not be asked to type the child's name as their own signature.
  const dob = request.rider.dob;
  const ageYears = Math.floor((Date.now() - dob.getTime()) / (365.25 * 86400_000));
  const isMinor = ageYears < 18;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Riding indemnity &amp; injury NOC</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          For <strong>{riderName}</strong> at {request.centre.name}.
          {isMinor
            ? " As they are under 18, a parent or guardian should sign."
            : " Please read both sections and sign below."}
        </p>
      </header>

      <section className="space-y-4">
        <article className="rounded-md border bg-muted/40 p-4 text-sm leading-relaxed">
          <h2 className="font-semibold">Indemnity &amp; liability release</h2>
          <p className="mt-2">{INDEMNITY_TEXT}</p>
          <p className="mt-2 text-xs text-muted-foreground">Version {INDEMNITY_VERSION}</p>
        </article>

        <article className="rounded-md border bg-muted/40 p-4 text-sm leading-relaxed">
          <h2 className="font-semibold">No-Objection Consent for injuries</h2>
          <p className="mt-2">{INJURY_NOC_TEXT}</p>
          <p className="mt-2 text-xs text-muted-foreground">Version {INJURY_NOC_VERSION}</p>
        </article>
      </section>

      <ConsentSignForm token={params.token} isMinor={isMinor} riderName={riderName} />
    </main>
  );
}
