"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/roles";
import type { FeatureKey } from "@/lib/features";
import { filterSidebarNav } from "./sidebar-nav";
import { Menu, X } from "lucide-react";
import { Horse } from "@/components/icons/horse";
import {
  LayoutDashboard,
  Users,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  TrendingUp,
  LineChart,
  ClipboardList,
  Trophy,
  Users2,
  ListChecks,
  Package,
  Pill,
  CalendarRange,
  Receipt,
  FileText,
  Award,
  Bell,
  Shield,
  UserCheck,
  CalendarX,
  Building2,
  UserCog,
  Syringe,
  Hammer,
  Bandage,
  GraduationCap,
  FileCheck,
  Building,
  Flag,
  ShoppingCart,
  MessageCircle,
  DoorOpen,
  Boxes,
  QrCode,
} from "lucide-react";

// Icon registry — referenced by name from sidebar-nav.ts so that file stays
// JSX-free and importable from tests/RSC contexts.
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  Users,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  TrendingUp,
  LineChart,
  ClipboardList,
  Trophy,
  Users2,
  ListChecks,
  Package,
  Pill,
  CalendarRange,
  Receipt,
  FileText,
  Award,
  Bell,
  Shield,
  UserCheck,
  CalendarX,
  Building2,
  UserCog,
  Syringe,
  Hammer,
  GraduationCap,
  FileCheck,
  Building,
  Flag,
  ShoppingCart,
  MessageCircle,
  DoorOpen,
  Boxes,
  QrCode,
  // Custom horse silhouette (no equivalent in lucide-react).
  Horse,
  // lucide-react exports the icon as `Bandage`; sidebar-nav.ts references it
  // as `BandageIcon` for clarity in nav definitions.
  BandageIcon: Bandage,
};

export function Sidebar({
  role,
  features,
}: {
  role: Role;
  features: readonly FeatureKey[];
}) {
  const pathname = usePathname();
  const groups = filterSidebarNav(role, new Set(features));
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-close the drawer on route change so navigating doesn't leave a
  // half-open sheet over the new page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Esc closes the drawer.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Mobile-only hamburger trigger. The desktop topbar already has
          plenty of buttons; this floats so the user can find it without
          scrolling. */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="fixed bottom-4 right-4 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Backdrop — tap to close. md+ devices never render either. */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          "border-r bg-card",
          // Mobile: fixed slide-in drawer.
          // Desktop: sticky full-height column with its OWN scroll, pinned to
          // the top of the viewport — so the page content scrolls but the nav
          // stays put (clicking a link no longer resets the sidebar position).
          // overscroll-contain stops wheel events from bubbling to the
          // main page when the sidebar's own scroll hits its boundary —
          // without it, scrolling past the bottom of the nav also scrolls
          // the dashboard, which felt like a UX glitch.
          "fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto overscroll-contain transition-transform duration-200",
          "md:sticky md:top-0 md:h-screen md:self-start md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b px-4">
          <div className="flex items-center gap-2">
            {/* Prefers the PNG asset at /equiwings-logo.png (client-provided),
                falls back to the bundled SVG fallback when the PNG isn't present. */}
            <picture>
              <source srcSet="/equiwings-logo.png" type="image/png" />
              <img
                src="/equiwings-logo.svg"
                alt="Equiwings"
                className="h-9 w-auto"
                width={72}
                height={36}
              />
            </picture>
            <div>
              <div className="text-sm font-bold leading-none">Equiwings</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Central Admin</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="rounded p-1 hover:bg-muted md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="p-3 text-sm">
        {groups.map((group) => (
          <div key={group.group} className="mb-4">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.group}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((it) => {
                const active = pathname === it.href || pathname.startsWith(it.href + "/");
                const Icon = ICONS[it.iconName];
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                        active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                      )}
                    >
                      {Icon && <Icon className="h-4 w-4" />}
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        </nav>
      </aside>
    </>
  );
}
