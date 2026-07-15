import { createHash } from "crypto";
import {
  ONBOARDING_AGREEMENT,
  ONBOARDING_DECLARATION,
  ONBOARDING_AGREEMENT_VERSION,
  ONBOARDING_DECLARATION_VERSION,
} from "@/lib/schemas/onboarding-staff";

// Proof-of-consent payload written to the audit log at submission time. It pins
// the EXACT agreement + declaration wording an employee accepted (version +
// content hash), the language they read it in, who signed, and when — so months
// later you can prove precisely what they agreed to, even if the text is edited
// afterwards (the hash won't match the new wording → the change is evident).
// English is the legally-operative text, so we hash that regardless of the
// language the employee chose to read.
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function employeeConsentProof(lang: "en" | "hi", signerName: string) {
  return {
    agreementVersion: ONBOARDING_AGREEMENT_VERSION,
    declarationVersion: ONBOARDING_DECLARATION_VERSION,
    agreementSha256: sha(ONBOARDING_AGREEMENT),
    declarationSha256: sha(ONBOARDING_DECLARATION),
    readLanguage: lang,
    signerName,
    acceptedAt: new Date().toISOString(),
  };
}

// The current consent version tag shown in the admin view.
export const CURRENT_CONSENT_VERSION = ONBOARDING_AGREEMENT_VERSION;
