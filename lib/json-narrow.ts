// Tolerant narrows for jsonb columns. Each helper accepts the raw value
// returned by Prisma (a JsonValue) — or a legacy string blob, or null /
// undefined — and produces a typed result, falling back to the empty case
// when the shape doesn't match. Goal: a malformed row never crashes the
// page; it just renders the empty state.
//
// Prefer these over inline `JSON.parse(x); if (Array.isArray(...)` ladders
// scattered across server components — duplication of that pattern was the
// reason for this file.

export type EmergencyContact = {
  label: string;
  number: string;
  type: string;
};

// Centre.emergencyContactsJson — array of { label, number, type }. We
// stringify-coerce label/number defensively (older rows occasionally store
// numbers as JSON numbers rather than strings); `type` falls back to "other"
// when missing so a half-filled legacy entry still renders.
export function parseEmergencyContacts(json: unknown): EmergencyContact[] {
  if (json === null || json === undefined || json === "") return [];
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x) => x && typeof x === "object" && typeof x.label === "string" && typeof x.number === "string")
      .map((x) => ({
        label: String(x.label),
        number: String(x.number),
        type: typeof x.type === "string" ? x.type : "other",
      }));
  } catch {
    return [];
  }
}

// "How many entries are in this jsonb array?" — used by list views that
// show a count without needing to materialise the entries themselves
// (e.g. InjuryLog.treatmentJson on the injuries table).
export function arrayLength(json: unknown): number {
  if (json === null || json === undefined || json === "") return 0;
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

// "Is this a plain object I can read keys off?" — true for `{}` and
// `{foo: 1}`, false for `null`, arrays, primitives. Use before casting a
// JsonValue to `Record<string, unknown>` for property access.
export function asRecord(json: unknown): Record<string, unknown> | null {
  if (json === null || json === undefined) return null;
  if (typeof json !== "object" || Array.isArray(json)) return null;
  return json as Record<string, unknown>;
}
