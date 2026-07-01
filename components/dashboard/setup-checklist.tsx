import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, CircleDot, ArrowRight } from "lucide-react";

// Onboarding checklist for new tenants. Shown only when at least one step is
// incomplete — disappears once the org has the basics in place so it doesn't
// clutter the dashboard for established centres.
export type ChecklistItem = {
  label: string;
  done: boolean;
  href: string;
  hint?: string;
};

export function SetupChecklist({ items }: { items: ChecklistItem[] }) {
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  if (done === total) return null;
  const pct = Math.round((done / total) * 100);

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Finish Setting up Your Centre</CardTitle>
          <span className="text-xs text-muted-foreground">{done}/{total} done</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm">
          {items.map((it) => (
            <li key={it.label}>
              <Link
                href={it.href}
                className={`flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-card ${
                  it.done ? "opacity-60" : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  {it.done ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <CircleDot className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={it.done ? "line-through" : "font-medium"}>{it.label}</span>
                  {it.hint && !it.done && (
                    <span className="text-xs text-muted-foreground">— {it.hint}</span>
                  )}
                </span>
                {!it.done && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
