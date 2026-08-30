import * as React from "react";
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
  KeyRound,
  FileSignature,
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
  Settings,
} from "lucide-react";

// Icon registry — referenced by name from sidebar-nav.ts (which stays JSX-free
// so it's importable from tests/RSC). Lives here, with no "use client", so the
// sidebar, the Help Center (a server component), and the onboarding checklist
// all render the SAME icon for a given nav item from one source of truth.
export const NAV_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
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
  KeyRound,
  FileSignature,
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
  Settings,
  // Custom horse silhouette (no equivalent in lucide-react).
  Horse,
  // lucide exports it as `Bandage`; nav defs reference it as `BandageIcon`.
  BandageIcon: Bandage,
};

/** Render a nav icon by its registry name. Renders nothing for unknown names. */
export function NavIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = name ? NAV_ICONS[name] : undefined;
  return Icon ? <Icon className={className} /> : null;
}
