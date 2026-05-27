// Pure data + filter logic for the sidebar. Kept JSX-free so tests can import
// `filterSidebarNav` without pulling in the React render path (Vitest + Vite's
// "use client" handling chokes on the sidebar.tsx file otherwise).

import type { Role } from "@/lib/roles";
import type { FeatureKey } from "@/lib/features";

const ALL_STAFF: Role[] = [
  "SUPER_ADMIN",
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "COACH",
  "STABLE_MANAGER",
  "INVENTORY_MANAGER",
  "COMPETITION_MANAGER",
  "GROOM",
  "FARRIER",
  "VET",
  "ACCOUNTANT",
  "EXAMINER",
  "JURY",
];

// Icons are looked up by name in the React render layer; we keep just the
// identifier here so this file stays JSX-free.
export type NavItem = {
  href: string;
  label: string;
  iconName: string;
  perm?: Role[];
  feature?: FeatureKey;
};

export type NavGroup = { group: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", iconName: "LayoutDashboard", perm: ALL_STAFF },
      { href: "/analytics", label: "Analytics", iconName: "LineChart", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "ACCOUNTANT"], feature: "analytics" },
      { href: "/centres", label: "Clubs (HQ)", iconName: "Building2", perm: ["SUPER_ADMIN"] },
      { href: "/users", label: "Users (HQ)", iconName: "UserCog", perm: ["SUPER_ADMIN"] },
      { href: "/hq-dashboard", label: "HQ Comparative", iconName: "LineChart", perm: ["SUPER_ADMIN"], feature: "hq-dashboard" },
      { href: "/hq-expenses", label: "HQ Invoices", iconName: "Receipt", perm: ["SUPER_ADMIN"] },
    ],
  },
  {
    group: "AMS · Athletes",
    items: [
      { href: "/riders", label: "Riders", iconName: "Users", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH", "EXAMINER", "COMPETITION_MANAGER"] },
      // Self-enrolment approval queue — School Admin / Centre Manager vet
      // public sign-ups before they become billable registrations.
      { href: "/enrolments", label: "Enrolment Approvals", iconName: "UserCheck", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "SCHOOL_ADMINISTRATOR"] },
      { href: "/batches", label: "Batches", iconName: "CalendarClock", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH"] },
      { href: "/lessons", label: "Lessons", iconName: "CalendarDays", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH"] },
      { href: "/attendance", label: "Attendance", iconName: "CalendarCheck2", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH"], feature: "attendance" },
      { href: "/progress", label: "Progress", iconName: "TrendingUp", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH"], feature: "skill-tracking" },
      // Sprint 4: month-by-month skill ratings curated per centre. Distinct from
      // /progress (which is the catalog of canonical skills per discipline).
      { href: "/monthly-skills", label: "Monthly Skills", iconName: "TrendingUp", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH"] },
      { href: "/exams", label: "Exams", iconName: "ClipboardList", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "EXAMINER", "JURY"], feature: "external-exams" },
      { href: "/competitions", label: "Competitions", iconName: "Trophy", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "COMPETITION_MANAGER", "JURY"], feature: "competitions" },
    ],
  },
  {
    group: "CMS · Centre",
    items: [
      { href: "/staff", label: "Staff", iconName: "Users2", perm: ["SUPER_ADMIN", "CENTRE_MANAGER"] },
      { href: "/staff-attendance", label: "Staff Attendance", iconName: "UserCheck", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "STABLE_MANAGER"], feature: "staff-attendance" },
      // Gate-log kiosk (MyGate-style In/Out). Same permission as attendance —
      // anyone who can mark roster attendance can also log gate entries.
      { href: "/gate", label: "Gate Log", iconName: "DoorOpen", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "STABLE_MANAGER"] },
      { href: "/training", label: "Training & Certs", iconName: "GraduationCap", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH"], feature: "training-certs" },
      { href: "/leave-requests", label: "Leave Requests", iconName: "CalendarX", perm: ALL_STAFF, feature: "leave-requests" },
      { href: "/tasks", label: "Tasks", iconName: "ListChecks", perm: ALL_STAFF, feature: "tasks" },
      // Daily Checklist — coaches/stable submit; HQ admins edit templates.
      { href: "/checklists", label: "Daily Checklist", iconName: "ClipboardList", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH", "STABLE_MANAGER", "GROOM"] },
      { href: "/checklists/templates", label: "Checklist Templates", iconName: "ClipboardList", perm: ["SUPER_ADMIN", "ADMIN"] },
      // Coach's daily 5-minute end-of-day update.
      { href: "/daily-update", label: "Daily Coach Update", iconName: "ClipboardList", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH"] },
      { href: "/approvals", label: "Approvals", iconName: "FileCheck", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "INVENTORY_MANAGER", "ACCOUNTANT", "STABLE_MANAGER"], feature: "approvals" },
      // Procurement requisitions — staff submits, manager + accountant approve.
      // Anyone with requisition.submit (i.e. all staff roles) sees the page.
      { href: "/requisitions", label: "Requisitions", iconName: "ShoppingCart", perm: ALL_STAFF },
      // WhatsApp deep-link generator — admins + senior centre staff. The
      // page-side gate matches this list (see app/(admin)/links/page.tsx).
      { href: "/links", label: "WhatsApp Links", iconName: "MessageCircle", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "STABLE_MANAGER"] },
      // Vendor contact-database — HQ-tier admins only.
      { href: "/vendors", label: "Vendors", iconName: "Building", perm: ["SUPER_ADMIN", "ADMIN"] },
      // Salary advances ledger — HQ admins + Accountant.
      { href: "/advances", label: "Salary Advances", iconName: "Receipt", perm: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
      // Monthly payroll — records salary + auto-deducts outstanding advances.
      { href: "/salary", label: "Salary & Payroll", iconName: "Receipt", perm: ["SUPER_ADMIN", "ADMIN", "ACCOUNTANT"] },
      { href: "/facility-bookings", label: "Facility Bookings", iconName: "Building", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH"], feature: "facility-bookings" },
      // Inventory: quantity-based catalog (EquipmentStock against EquipmentCatalog).
      // Per-item Asset tracking was removed in the consolidation — clubs found
      // the parallel system confusing, and the bulk view answers the
      // "do we have enough" question that drives day-to-day decisions.
      { href: "/equipment", label: "Tack & Equipment", iconName: "Package", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "STABLE_MANAGER", "INVENTORY_MANAGER", "HEAD_COACH", "GROOM"], feature: "inventory" },
      { href: "/medicines", label: "Vet Medicines", iconName: "Pill", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "VET", "INVENTORY_MANAGER", "ACCOUNTANT"], feature: "vet-records" },
      // Cross-horse vet follow-up calendar — companion view to the per-horse
      // Vet Visits panel. Same permission set so VET / horse.manage roles see it.
      { href: "/vet-followups", label: "Vet Follow-ups", iconName: "CalendarClock", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "VET", "HEAD_COACH", "STABLE_MANAGER"], feature: "vet-records" },
      { href: "/consumables", label: "First-Aid Consumables", iconName: "BandageIcon", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "VET", "STABLE_MANAGER", "INVENTORY_MANAGER", "GROOM"], feature: "consumables" },
      { href: "/horses", label: "Horses", iconName: "Horse", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "VET", "STABLE_MANAGER", "FARRIER", "GROOM"], feature: "horse-management" },
      { href: "/vaccinations", label: "Vaccinations", iconName: "Syringe", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "VET", "STABLE_MANAGER"], feature: "vet-records" },
      { href: "/farriery", label: "Farriery", iconName: "Hammer", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "STABLE_MANAGER", "FARRIER"], feature: "farriery" },
      // Grooms + farriers are routinely first to spot injuries; coach roles
      // and the vet need to see them too.
      { href: "/injuries", label: "Injury Log", iconName: "BandageIcon", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH", "VET", "STABLE_MANAGER", "GROOM", "FARRIER"], feature: "injuries" },
      { href: "/events", label: "Events", iconName: "CalendarRange", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COMPETITION_MANAGER"], feature: "events" },
      { href: "/teams", label: "Teams / Squads", iconName: "Flag", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COMPETITION_MANAGER"], feature: "teams" },
      // Event transport — horses + equipment manifest with check-out / check-in.
      { href: "/transport", label: "Event Transport", iconName: "CalendarRange", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "STABLE_MANAGER", "COMPETITION_MANAGER"] },
    ],
  },
  {
    group: "Money & Records",
    items: [
      { href: "/finance", label: "Finance", iconName: "Receipt", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "ACCOUNTANT"], feature: "fee-collection" },
      // Staff-side invoice submission. Distinct from the admin finance page —
      // visible to coaches/grooms/vet/etc so they can drop in bills for things
      // they purchased on behalf of the club.
      { href: "/expenses/submit", label: "Submit Invoice", iconName: "Receipt", perm: ["HEAD_COACH", "COACH", "STABLE_MANAGER", "INVENTORY_MANAGER", "COMPETITION_MANAGER", "GROOM", "FARRIER", "VET"] },
      { href: "/reports", label: "Reports", iconName: "FileText", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH", "EXAMINER"], feature: "reports" },
      { href: "/certificates", label: "Certificates", iconName: "Award", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "EXAMINER", "COMPETITION_MANAGER"], feature: "certificates" },
      { href: "/accreditations", label: "Accreditations", iconName: "Shield", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COMPETITION_MANAGER"], feature: "accreditations" },
      { href: "/notifications", label: "Notifications", iconName: "Bell", perm: ALL_STAFF },
      { href: "/audit", label: "Audit Log", iconName: "Shield", perm: ["SUPER_ADMIN"] },
      // Manual inspections / SOP audits — run by the external Inspection Officer
      // or admins/centre manager.
      { href: "/inspections", label: "Inspections", iconName: "Shield", perm: ["INSPECTION_OFFICER", "SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"] },
    ],
  },
];

export function filterSidebarNav(role: Role, features: ReadonlySet<FeatureKey>): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((it) => {
      if (it.perm && !it.perm.includes(role)) return false;
      if (it.feature && !features.has(it.feature)) return false;
      return true;
    }),
  })).filter((g) => g.items.length > 0);
}
