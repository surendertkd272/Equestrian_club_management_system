// Feature registry — single source of truth for toggleable modules.
// The owner portal turns these on/off per tenant; routes & UI gate behind them.
// Plan→feature mapping lives in lib/plans.ts; this file is the menu.
//
// Adding a new module checklist:
//   1. Add the FeatureKey here + an entry in FEATURES below.
//   2. Map it into lib/plans.ts so Starter/Pro/Enterprise bundles include it.
//   3. Add `blockIfFeatureOff(session, "<key>")` to the module's API routes.
//   4. Add `feature: "<key>"` to the sidebar entry in components/shell/sidebar-nav.ts.

export type FeatureKey =
  // Core operations
  | "attendance"
  | "skill-tracking"
  | "internal-exams"
  | "external-exams"
  | "certificates"
  | "events"
  // People
  | "staff-attendance"
  | "parent-portal"
  | "student-portal"
  | "leave-requests"
  | "training-certs"
  | "teams"
  | "accreditations"
  // Facility
  | "horse-management"
  | "vet-records"
  | "inventory"
  | "consumables"
  | "farriery"
  | "injuries"
  | "facility-bookings"
  // Finance
  | "fee-collection"
  | "expenses"
  // Productivity
  | "tasks"
  | "approvals"
  | "reports"
  | "analytics"
  | "whatsapp-notifications"
  // Advanced / HQ-only
  | "hq-dashboard"
  // Per-tenant on/off for chrome features. Default OFF — owner toggles
  // them on in the feature matrix when the tenant explicitly wants them.
  | "club-catalog"
  | "student-payment-visible";

// "wired" — toggling off blocks both the UI route AND the underlying API
// endpoints (blockIfFeatureOff in route handlers). Safe to disable for a
// paying customer with full effect.
// "ui-only" — toggle hides the sidebar entry, but the API endpoints don't
// yet check the flag. A user typing the URL directly will still reach data.
// Treat the toggle as a signal/intent, not a billable gate, until the API
// check is added. The owner UI surfaces this state explicitly so the platform
// team doesn't sell a guarantee we don't yet enforce.
export type FeatureEnforcement = "wired" | "ui-only";

export type FeatureDef = {
  key: FeatureKey;
  label: string;
  description: string;
  group: "operations" | "people" | "facility" | "finance" | "productivity" | "advanced";
  enforcement: FeatureEnforcement;
  // When true, the owner can toggle this feature on ANY plan (not Enterprise-
  // gated), even though it's `wired` (API-enforced). Lets us harden a feature's
  // access (off = real block) without turning it into a billable plan lever.
  // Defaults to: ui-only features are self-toggleable, wired ones are not.
  selfToggle?: boolean;
};

export const FEATURES: readonly FeatureDef[] = [
  // ── Operations
  { key: "attendance",             label: "Rider Attendance",       description: "Mark and review rider attendance per batch.",                    group: "operations",   enforcement: "wired", selfToggle: true },
  { key: "skill-tracking",         label: "Skill Tracking",         description: "Track per-rider skill progress across disciplines.",             group: "operations",   enforcement: "wired", selfToggle: true },
  { key: "internal-exams",         label: "Internal Exams",         description: "Schedule and score in-house promotion exams.",                   group: "operations",   enforcement: "ui-only" },
  { key: "external-exams",         label: "External Examinations",  description: "Formal exam workflow with external examiners (EFI-style).",     group: "operations",   enforcement: "wired" },
  { key: "certificates",           label: "Certificates",           description: "Issue QR-verified certificates for promotions + events.",         group: "operations",   enforcement: "wired", selfToggle: true },
  { key: "events",                 label: "Events",                 description: "Clinics, schooling days, fundraisers, external shows.",          group: "operations",   enforcement: "wired" },

  // ── People
  { key: "staff-attendance",       label: "Staff Attendance",       description: "Daily staff check-in / leave tracking.",                         group: "people",       enforcement: "wired", selfToggle: true },
  { key: "parent-portal",          label: "Parent Portal",          description: "Parents log in to see their kids' progress and bills.",          group: "people",       enforcement: "wired" },
  { key: "student-portal",         label: "Student / Rider Portal", description: "Riders log in to see their attendance, skills, and exams.",     group: "people",       enforcement: "wired" },
  { key: "leave-requests",         label: "Leave Requests",         description: "Staff request leave; managers approve.",                         group: "people",       enforcement: "wired", selfToggle: true },
  { key: "training-certs",         label: "Training & Certs",       description: "Staff courses + external certifications register.",              group: "people",       enforcement: "wired", selfToggle: true },
  { key: "teams",                  label: "Teams / Squads",         description: "Group riders into named teams (squads).",         group: "people",       enforcement: "wired", selfToggle: true },
  { key: "accreditations",         label: "Rider Accreditations",   description: "Track external federation memberships per rider (EFI/BHS/FEI).", group: "people",       enforcement: "wired" },

  // ── Facility
  { key: "horse-management",       label: "Horse Management",       description: "Track horses, allocations, and ownership.",                      group: "facility",     enforcement: "wired" },
  { key: "vet-records",            label: "Vet Records",            description: "Medicine inventory and per-horse treatment logs.",               group: "facility",     enforcement: "wired" },
  { key: "inventory",              label: "Tack & Equipment",       description: "Tag, issue, and maintain saddles, gear, and school assets.",     group: "facility",     enforcement: "wired" },
  { key: "consumables",            label: "First-Aid Consumables",  description: "Per-centre stock of bandages, antiseptics, etc.",                group: "facility",     enforcement: "wired", selfToggle: true },
  { key: "farriery",               label: "Farriery",               description: "Schedule and track farrier visits per horse.",                   group: "facility",     enforcement: "wired" },
  { key: "injuries",               label: "Injury Log",             description: "Horse + rider injury records with recovery tracking.",            group: "facility",     enforcement: "wired", selfToggle: true },
  { key: "facility-bookings",      label: "Facility Bookings",      description: "Book arenas / wash bays / classroom slots.",                     group: "facility",     enforcement: "wired", selfToggle: true },

  // ── Finance
  { key: "fee-collection",         label: "Parent / Rider Payments", description: "Switch for parent + rider-facing payment surfaces. When OFF: no invoices created on enrolment / event entry, /pay page 404s, Razorpay endpoints return 503, fee-due reminders skipped, approved riders go straight to active, parent invoice tiles hide. Staff bookkeeping (the /finance dashboard, manual cash recording, exports, invoice print) is unaffected so the team can still log offline payments. Existing invoices preserved as audit history.", group: "finance", enforcement: "wired" },
  { key: "expenses",               label: "Expenses & P&L",         description: "Book outgoings against chart-of-accounts; expense P&L.",         group: "finance",      enforcement: "wired" },

  // ── Productivity
  { key: "tasks",                  label: "Tasks",                  description: "Kanban for daily centre tasks + assignments.",                   group: "productivity", enforcement: "wired", selfToggle: true },
  { key: "approvals",              label: "Approvals",              description: "Generic approval workflow (purchases, special requests).",       group: "productivity", enforcement: "wired", selfToggle: true },
  { key: "reports",                label: "Reports",                description: "Monthly parent report cards + analytical exports.",              group: "productivity", enforcement: "wired", selfToggle: true },
  { key: "analytics",              label: "Analytics",              description: "Per-rider performance trends.",             group: "productivity", enforcement: "wired", selfToggle: true },
  { key: "whatsapp-notifications", label: "WhatsApp Notifications", description: "Send class reminders, dues, and certificates via WhatsApp.",    group: "productivity", enforcement: "wired", selfToggle: true },

  // ── Advanced / HQ-only
  { key: "hq-dashboard",           label: "HQ Comparative Dashboard", description: "Cross-centre side-by-side reporting for multi-club operators.", group: "advanced",   enforcement: "wired", selfToggle: true },

  // ── Per-tenant chrome toggles — default OFF for new orgs (see seed.ts /
  // /api/orgs onboarding). Owner toggles ON in the feature matrix when a
  // specific tenant wants the feature exposed.
  { key: "club-catalog",            label: "Club Catalog",            description: "Per-club catalog editor for fee plans, levels, skills. Hidden by default — owner toggles on for clubs that need to customise the catalog.", group: "advanced", enforcement: "wired", selfToggle: true },
  { key: "student-payment-visible", label: "Student-Portal Payments", description: "Show payment/invoice surfaces in the student (rider) portal. Hidden by default — payments are typically handled by the parent via emailed links, not students directly.", group: "advanced", enforcement: "ui-only" },
];

export const FEATURE_KEYS: readonly FeatureKey[] = FEATURES.map((f) => f.key);

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && (FEATURE_KEYS as readonly string[]).includes(value);
}

// Whether the owner may toggle this feature on ANY plan (vs Enterprise-only).
// Explicit `selfToggle` wins; otherwise ui-only features are self-toggleable.
export function canSelfToggle(key: FeatureKey): boolean {
  const f = FEATURES.find((x) => x.key === key);
  if (!f) return false;
  return f.selfToggle ?? f.enforcement === "ui-only";
}
