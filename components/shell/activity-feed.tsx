import Link from "next/link";
import { timeAgo, formatDateTimeIndia } from "@/lib/i18n";
import type { ActivityItem } from "@/lib/activity";

const KIND_EMOJI: Record<string, string> = {
  "attendance.present": "✅",
  "attendance.absent": "❌",
  "attendance.late": "🕒",
  "attendance.excused": "🛡️",
  "exam.passed": "🎉",
  "exam.completed": "📝",
  "exam.scheduled": "📅",
  "certificate.promotion": "🏅",
  "certificate.participation": "📜",
  "certificate.winner": "🏆",
  "skill.mastered": "⭐",
  "parent.linked": "👪",
  "injury.minor": "🩹",
  "injury.moderate": "🚑",
  "injury.severe": "🚨",
  "health.vitals": "🌡️",
  "vaccination.given": "💉",
  "farrier.scheduled": "🔨",
  "farrier.completed": "🐴",
  "medicine.used": "💊",
};

function emojiFor(kind: string): string {
  if (KIND_EMOJI[kind]) return KIND_EMOJI[kind];
  if (kind.startsWith("allocation.")) return "🐎";
  return "•";
}

export function ActivityFeed({ items, title = "Activity" }: { items: ActivityItem[]; title?: string }) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border bg-card p-4 text-sm text-muted-foreground">
        No activity yet.
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-card">
      <div className="border-b px-4 py-2 text-sm font-semibold">{title}</div>
      <ol className="divide-y">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-3 px-4 py-2 text-sm">
            <span className="mt-0.5 text-lg leading-none">{emojiFor(it.kind)}</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {it.link ? <Link href={it.link} className="hover:underline">{it.title}</Link> : it.title}
              </div>
              {it.detail && <div className="text-xs text-muted-foreground">{it.detail}</div>}
            </div>
            <time
              className="shrink-0 text-xs text-muted-foreground"
              title={formatDateTimeIndia(it.at)}
            >
              {timeAgo(it.at)}
            </time>
          </li>
        ))}
      </ol>
    </div>
  );
}
