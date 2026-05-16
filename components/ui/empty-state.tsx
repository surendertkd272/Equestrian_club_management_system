import Link from "next/link";
import { Button } from "@/components/ui/button";

// Empty-state hero. Used instead of "No data" so users know where to click
// next. Use this on every list page that can land empty (riders, horses,
// medicines, competitions, etc.) — onboarding teach-through.
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: { href?: string; onClick?: () => void; label: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border bg-card px-6 py-12 text-center">
      {icon && <div className="mb-3 text-3xl opacity-70">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && (
        <div className="mt-4">
          {action.href ? (
            <Button asChild>
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : (
            <Button onClick={action.onClick}>{action.label}</Button>
          )}
        </div>
      )}
    </div>
  );
}
