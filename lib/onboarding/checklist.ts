// Personal "Getting started" activation checklist — role-aware first tasks for
// a new staff member, shown on their dashboard until done or dismissed.
//
// Scope is deliberate. SUPER_ADMIN and CENTRE_MANAGER already get the existing
// auto-detected "Finish setting up your centre" SetupChecklist (gated to those
// two roles in dashboard/page.tsx), so they return [] here. ADMIN — a single,
// experienced delegated HQ operator — intentionally gets no starter card
// either. Portal roles (RIDER/PARENT/SCHOOL_ADMINISTRATOR) and INSPECTION_OFFICER
// aren't in the staff dashboard. Everyone else gets a short, role-specific list,
// feature-gated to what the club has enabled — the same way the sidebar + Help
// guide are.

import type { Role } from "@/lib/roles";
import type { FeatureKey } from "@/lib/features";
import { NAV } from "@/components/shell/sidebar-nav";

export type ChecklistTask = {
  key: string;
  label: string;
  href: string;
  // Auto-detected completion signal (vs. manual tick). Lets a couple of items
  // feel "alive" — they complete when the user actually does them.
  auto?: "tour" | "photo";
};

// Two universal account-setup items, auto-detected from the user's own row.
const UNIVERSAL: ChecklistTask[] = [
  { key: "tour", label: "Take the 30-second guided tour", href: "/dashboard?tour=1", auto: "tour" },
  { key: "photo", label: "Add a profile photo", href: "/account", auto: "photo" },
];

// Role-specific first actions. Manual tick (each links to where you do it).
const STAFF_TASKS: Partial<Record<Role, ChecklistTask[]>> = {
  COACH: [
    { key: "lessons", label: "Open today's lessons", href: "/lessons" },
    { key: "attendance", label: "Mark attendance for a class", href: "/attendance" },
    { key: "daily-update", label: "File your end-of-day update", href: "/daily-update" },
  ],
  HEAD_COACH: [
    { key: "lessons", label: "Review today's lessons", href: "/lessons" },
    { key: "approvals", label: "Clear your approvals queue", href: "/approvals" },
    { key: "team-update", label: "Read the team's daily updates", href: "/daily-update/team" },
  ],
  VET: [
    { key: "followups", label: "Check the vet follow-up calendar", href: "/vet-followups" },
    { key: "medicines", label: "Review medicine stock", href: "/medicines" },
    { key: "vaccinations", label: "Check vaccination due-dates", href: "/vaccinations" },
  ],
  STABLE_MANAGER: [
    { key: "horses", label: "Review the horse roster", href: "/horses" },
    { key: "equipment", label: "Check tack & equipment stock", href: "/equipment" },
    { key: "farriery", label: "Look over the farriery schedule", href: "/farriery" },
  ],
  GROOM: [
    { key: "checklist", label: "Complete today's checklist", href: "/checklists" },
    { key: "horses", label: "See the horses in your care", href: "/horses" },
    { key: "injuries", label: "Find where to log an injury", href: "/injuries" },
  ],
  FARRIER: [
    { key: "farriery", label: "Open the farriery schedule", href: "/farriery" },
    { key: "horses", label: "Browse the horse roster", href: "/horses" },
  ],
  EXAMINER: [
    { key: "exams", label: "Find the exams you'll score", href: "/exams" },
    { key: "certificates", label: "See issued certificates", href: "/certificates" },
  ],
  ACCOUNTANT: [
    { key: "finance", label: "Open the finance dashboard", href: "/finance" },
    { key: "salary", label: "Review salary & payroll", href: "/salary" },
    { key: "approvals", label: "Clear finance approvals", href: "/approvals" },
  ],
  INVENTORY_MANAGER: [
    { key: "equipment", label: "Review tack & equipment stock", href: "/equipment" },
    { key: "requisitions", label: "Check purchase requisitions", href: "/requisitions" },
  ],
};

/**
 * The starter checklist for a role: universal account items + role tasks.
 * Returns [] for roles that shouldn't see this card (admins, portal roles,
 * inspection officer) so the card simply doesn't render for them.
 */
// href → required feature (if any), derived from the sidebar so the checklist
// hides tasks pointing at modules the club hasn't enabled — matching exactly
// what the user can navigate to.
const FEATURE_BY_HREF = new Map<string, FeatureKey | undefined>();
for (const g of NAV) for (const it of g.items) FEATURE_BY_HREF.set(it.href, it.feature);

export function buildChecklist(role: Role, features: ReadonlySet<FeatureKey>): ChecklistTask[] {
  const roleTasks = STAFF_TASKS[role];
  if (!roleTasks) return [];
  return [...UNIVERSAL, ...roleTasks].filter((t) => {
    const feat = FEATURE_BY_HREF.get(t.href.split("?")[0]);
    return !feat || features.has(feat);
  });
}
