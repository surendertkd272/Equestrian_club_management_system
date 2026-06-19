// Pure data + filter logic for the sidebar. Kept JSX-free so tests can import
// `filterSidebarNav` without pulling in the React render path (Vitest + Vite's
// "use client" handling chokes on the sidebar.tsx file otherwise).

import type { Role } from "@/lib/roles";
import type { FeatureKey } from "@/lib/features";

const ALL_STAFF: Role[] = [
  "SUPER_ADMIN",
  "ADMIN", // HQ peer of SUPER_ADMIN — was missing, so it lost Dashboard/Notifications/Tasks/Leave/Requisitions
  "CENTRE_MANAGER",
  "HEAD_COACH",
  "COACH",
  "STABLE_MANAGER",
  "INVENTORY_MANAGER",
  "GROOM",
  "FARRIER",
  "VET",
  "ACCOUNTANT",
  "EXAMINER",
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
      { href: "/analytics", label: "Analytics", iconName: "LineChart", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "ACCOUNTANT"], feature: "analytics" },
      // ADMIN is a cross-club HQ peer of SUPER_ADMIN — sees every club's
      // rollups, invoices, and club list. Club CREATE/DELETE + HQ-user
      // management stay SUPER_ADMIN-only (see page/API guards), so /users
      // is not granted to ADMIN.
      { href: "/centres", label: "Clubs (HQ)", iconName: "Building2", perm: ["SUPER_ADMIN", "ADMIN"] },
      { href: "/users", label: "Users (HQ)", iconName: "UserCog", perm: ["SUPER_ADMIN", "ADMIN"] },
      { href: "/hq-dashboard", label: "HQ Comparative", iconName: "LineChart", perm: ["SUPER_ADMIN", "ADMIN"], feature: "hq-dashboard" },
      { href: "/hq-expenses", label: "HQ Invoices", iconName: "Receipt", perm: ["SUPER_ADMIN", "ADMIN"] },
    ],
  },
  {
    group: "Riders & Training",
    items: [
      { href: "/riders", label: "Riders", iconName: "Users", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH", "EXAMINER", "SCHOOL_ADMINISTRATOR"] },
      // Self-enrolment approval queue — School Admin / Centre Manager vet
      // public sign-ups before they become billable registrations.
      { href: "/enrolments", label: "Enrolment Approvals", iconName: "UserCheck", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "SCHOOL_ADMINISTRATOR"] },
      { href: "/batches", label: "Batches", iconName: "CalendarClock", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH"] },
      { href: "/lessons", label: "Lessons", iconName: "CalendarDays", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH"] },
      { href: "/attendance", label: "Attendance", iconName: "CalendarCheck2", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH", "SCHOOL_ADMINISTRATOR"], feature: "attendance" },
      { href: "/progress", label: "Progress", iconName: "TrendingUp", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH", "SCHOOL_ADMINISTRATOR"], feature: "skill-tracking" },
      // Club Catalog — manage fee plans, progress levels, and skills per club.
      { href: "/catalog", label: "Club Catalog", iconName: "ClipboardList", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"], feature: "club-catalog" },
      // Sprint 4: month-by-month skill ratings curated per centre. Distinct from
      // /progress (which is the catalog of canonical skills per discipline).
      { href: "/monthly-skills", label: "Monthly Skills", iconName: "TrendingUp", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH", "SCHOOL_ADMINISTRATOR"] },
      { href: "/exams", label: "Exams", iconName: "ClipboardList", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "EXAMINER", "SCHOOL_ADMINISTRATOR"], feature: "external-exams" },
    ],
  },
  {
    group: "Staff & Operations",
    items: [
      { href: "/staff", label: "Staff", iconName: "Users2", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"] },
      { href: "/staff/onboarding", label: "Employee Onboarding", iconName: "UserCheck", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"] },
      { href: "/staff-attendance", label: "Staff Attendance", iconName: "UserCheck", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "STABLE_MANAGER"], feature: "staff-attendance" },
      // Gate-log kiosk (MyGate-style In/Out). Same permission as attendance —
      // anyone who can mark roster attendance can also log gate entries.
      { href: "/gate", label: "Gate Log", iconName: "DoorOpen", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "STABLE_MANAGER"] },
      { href: "/training", label: "Training & Certs", iconName: "GraduationCap", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH"], feature: "training-certs" },
      { href: "/leave-requests", label: "Leave Requests", iconName: "CalendarX", perm: ALL_STAFF, feature: "leave-requests" },
      { href: "/tasks", label: "Tasks", iconName: "ListChecks", perm: ALL_STAFF, feature: "tasks" },
      // Daily Checklist — coaches/stable submit; HQ admins edit templates.
      { href: "/checklists", label: "Daily Checklist", iconName: "ClipboardList", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH", "STABLE_MANAGER", "GROOM"] },
      { href: "/checklists/templates", label: "Checklist Templates", iconName: "ClipboardList", perm: ["SUPER_ADMIN", "ADMIN"] },
      // Coach's daily 5-minute end-of-day update.
      { href: "/daily-update", label: "Daily Coach Update", iconName: "ClipboardList", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH"] },
      // Manager rollup of the whole team's daily updates.
      { href: "/daily-update/team", label: "Team Daily Updates", iconName: "ClipboardList", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH"] },
      { href: "/approvals", label: "Approvals", iconName: "FileCheck", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "INVENTORY_MANAGER", "ACCOUNTANT", "STABLE_MANAGER"], feature: "approvals" },
      { href: "/batch-shifts", label: "Batch Shifts", iconName: "CalendarRange", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH"] },
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
    ],
  },
  {
    group: "Stable & Veterinary",
    items: [
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
    ],
  },
  {
    group: "Events & Teams",
    items: [
      { href: "/events", label: "Events", iconName: "CalendarRange", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH"], feature: "events" },
      { href: "/teams", label: "Teams / Squads", iconName: "Flag", perm: ["SUPER_ADMIN", "CENTRE_MANAGER", "HEAD_COACH"], feature: "teams" },
      // Event transport — horses + equipment manifest with check-out / check-in.
      { href: "/transport", label: "Event Transport", iconName: "CalendarRange", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "STABLE_MANAGER"] },
    ],
  },
  {
    group: "Money & Records",
    items: [
      { href: "/finance", label: "Finance", iconName: "Receipt", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "ACCOUNTANT"] },
      // Staff-side invoice submission. Distinct from the admin finance page —
      // visible to coaches/grooms/vet/etc so they can drop in bills for things
      // they purchased on behalf of the club.
      { href: "/expenses/submit", label: "Submit Invoice", iconName: "Receipt", perm: ["HEAD_COACH", "COACH", "STABLE_MANAGER", "INVENTORY_MANAGER", "GROOM", "FARRIER", "VET"] },
      { href: "/reports", label: "Reports", iconName: "FileText", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH", "COACH", "EXAMINER", "SCHOOL_ADMINISTRATOR"], feature: "reports" },
      // Club-wise procurement snapshot (Farrier/Fodder/Hay/Vet medicines).
      { href: "/reports/procurement", label: "Procurement Report", iconName: "FileText", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "ACCOUNTANT"], feature: "expenses" },
      { href: "/certificates", label: "Certificates", iconName: "Award", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "EXAMINER", "SCHOOL_ADMINISTRATOR"], feature: "certificates" },
      { href: "/accreditations", label: "Accreditations", iconName: "Shield", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER", "HEAD_COACH"], feature: "accreditations" },
      { href: "/notifications", label: "Notifications", iconName: "Bell", perm: ALL_STAFF },
      { href: "/audit", label: "Audit Log", iconName: "Shield", perm: ["SUPER_ADMIN"] },
      // Manual inspections / SOP audits — run by the external Inspection Officer
      // or admins/centre manager.
      { href: "/inspections", label: "Inspections", iconName: "Shield", perm: ["INSPECTION_OFFICER", "SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"] },
      // Recycle bin — soft-deleted catalog rows, recoverable for 30 days then auto-purged.
      { href: "/bin", label: "Recycle Bin", iconName: "Package", perm: ["SUPER_ADMIN", "ADMIN", "CENTRE_MANAGER"] },
    ],
  },
];

// Role allow-list for a route, from the NAV table. Pages call canAccessRoute()
// as a server-side guard so a hidden nav link can't be reached by typing the
// URL (the nav only HIDES links; this enforces it). Returns null if the route
// isn't in NAV (no role restriction declared).
export function navPermFor(href: string): Role[] | null {
  for (const group of NAV) {
    for (const it of group.items) {
      if (it.href === href) return it.perm ?? null;
    }
  }
  return null;
}

export function canAccessRoute(role: Role, href: string): boolean {
  const perm = navPermFor(href);
  return perm ? perm.includes(role) : true;
}

// Role-specific "Pinned" shortcuts that appear above all other nav groups.
// Each entry lists hrefs (in display order) that map to existing NavItems
// in NAV; the filterSidebarNav() function looks the items up and assembles
// them into a top group. Items still go through the same feature + perm
// filtering as the rest of the sidebar — so a pinned page that requires
// a feature flag still hides if the flag's off.
//
// Ordering reasoning per role lives in the comments below. Roles not in
// this map (notably SUPER_ADMIN, ADMIN) get no pinned section — their
// daily flow is too varied for shortcuts to help.
const ROLE_PINS: Partial<Record<Role, string[]>> = {
  // Coach's day: check today's lessons → mark attendance as riders arrive
  // → log skill progress during/after → end-of-day daily checklist.
  COACH: ["/lessons", "/attendance", "/progress", "/checklists"],
  // Head Coach is a coach + the team's first-line approver.
  HEAD_COACH: ["/lessons", "/attendance", "/approvals", "/daily-update"],
  // Groom's morning is structured by the daily checklist; the rest are
  // reference points they hit when something looks off.
  GROOM: ["/checklists", "/horses", "/injuries", "/medicines"],
  // Stable manager coordinates animals + tack + farrier/vet schedules.
  STABLE_MANAGER: ["/horses", "/equipment", "/farriery", "/vaccinations", "/checklists"],
  // Vet's day starts with the follow-up calendar.
  VET: ["/vet-followups", "/medicines", "/horses", "/vaccinations", "/injuries"],
  // Farrier has a narrow surface — schedule + horse health.
  FARRIER: ["/farriery", "/horses", "/injuries"],
  // Centre manager: queue-clearing first (approvals + new enrolments),
  // then finance overview, then who's at the gate today.
  CENTRE_MANAGER: ["/approvals", "/enrolments", "/finance", "/staff-attendance", "/gate"],
  // Accountant: cash work first, queue second.
  ACCOUNTANT: ["/finance", "/approvals", "/salary", "/advances"],
  // Inventory manager: stock-centric.
  INVENTORY_MANAGER: ["/equipment", "/requisitions", "/consumables", "/medicines"],
  // School administrator: read-only club-wide view of student data.
  // No write perms (left out of every can() check); they observe.
  SCHOOL_ADMINISTRATOR: ["/riders", "/attendance", "/progress", "/exams"],
  // Examiner runs exam days.
  EXAMINER: ["/exams", "/certificates", "/riders"],
  // Inspection officer's whole job is the inspections + audit pair.
  INSPECTION_OFFICER: ["/inspections", "/audit"],
};

// Flatten NAV once into an href → NavItem index. Used by filterSidebarNav
// to resolve pinned hrefs to the canonical NavItem (carrying iconName +
// perm + feature) without re-walking the groups per pin.
const NAV_INDEX = new Map<string, NavItem>();
for (const group of NAV) for (const it of group.items) NAV_INDEX.set(it.href, it);

export function filterSidebarNav(role: Role, features: ReadonlySet<FeatureKey>): NavGroup[] {
  // Pinned group first — only assembled when the role has pins AND at least
  // one resolves after perm + feature filtering. Items in this top group
  // ALSO remain in their original group below; this is a shortcut surface,
  // not a relocation, so muscle memory keeps working.
  const pins = ROLE_PINS[role] ?? [];
  const pinnedItems: NavItem[] = [];
  for (const href of pins) {
    const it = NAV_INDEX.get(href);
    if (!it) continue;
    if (it.perm && !it.perm.includes(role)) continue;
    if (it.feature && !features.has(it.feature)) continue;
    pinnedItems.push(it);
  }
  const groups: NavGroup[] = [];
  if (pinnedItems.length > 0) {
    groups.push({ group: "Pinned for you", items: pinnedItems });
  }
  for (const group of NAV) {
    const items = group.items.filter((it) => {
      if (it.perm && !it.perm.includes(role)) return false;
      if (it.feature && !features.has(it.feature)) return false;
      return true;
    });
    if (items.length > 0) groups.push({ ...group, items });
  }
  return groups;
}
