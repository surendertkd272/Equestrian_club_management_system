import {
  Trophy, Medal, ClipboardList, PawPrint, HeartPulse, Syringe, Pill, Bandage, Hourglass,
  GraduationCap, Award, FilePen, CalendarCheck, ClipboardCheck, ListChecks, IndianRupee,
  CalendarClock, Users, Shuffle, AlarmClock, CheckCircle2, Activity, Building2, Clock,
  AlertTriangle, RefreshCw, type LucideIcon,
} from "lucide-react";

// Pick a sensible icon from a KPI label (keyword rules, first match wins) so
// every dashboard tile gets an icon without per-call wiring. Shared by the
// admin role dashboards, the student portal, and the HQ dashboard.
const KPI_ICON_RULES: [RegExp, LucideIcon][] = [
  [/error|fail/, AlertTriangle],
  [/tenant|centre|club\b|^org/, Building2],
  [/cron|sweep|sync/, RefreshCw],
  [/trial/, Clock],
  [/competition/, Trophy],
  [/placement|medal/, Medal],
  [/entr(y|ies)/, ClipboardList],
  [/horse/, PawPrint],
  [/injur/, HeartPulse],
  [/vaccinat/, Syringe],
  [/consumable/, Bandage],
  [/med(icine)?\b|meds/, Pill],
  [/expir/, Hourglass],
  [/exam/, GraduationCap],
  [/cert/, Award],
  [/score|draft/, FilePen],
  [/attendance|unmarked|present/, CalendarCheck],
  [/checklist|update/, ClipboardCheck],
  [/task/, ListChecks],
  [/invoice|paid|collected|revenue|fee|due|₹/, IndianRupee],
  [/batch|lesson/, CalendarClock],
  [/rider|student|user|staff|login|signup/, Users],
  [/allocation/, Shuffle],
  [/overdue/, AlarmClock],
  [/completed|pass/, CheckCircle2],
  [/upcoming/, CalendarClock],
];

export function kpiIcon(label: string) {
  const l = label.toLowerCase();
  const Icon = KPI_ICON_RULES.find(([re]) => re.test(l))?.[1] ?? Activity;
  return <Icon className="h-5 w-5" />;
}
