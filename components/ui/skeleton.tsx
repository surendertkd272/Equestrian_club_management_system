import { cn } from "@/lib/utils";

// Generic skeleton primitive. Use through SkeletonRow / SkeletonCard for
// quick scaffolding of loading states.
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted/60", className)} {...props} />;
}

export function SkeletonRow({ cols = 4 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-3 border-t py-2">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-4 flex-1" />
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <Skeleton className="mb-3 h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="mt-2 h-3 w-full" />
      ))}
    </div>
  );
}

// Dashboard / list shell — 4 KPI cards + a 6-row table. The default loading
// state for any page that fetches a list + KPIs.
export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-7 w-48" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={1} />)}
      </div>
      <div className="rounded-lg border bg-card p-4">
        <Skeleton className="mb-3 h-4 w-1/4" />
        {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}
      </div>
    </div>
  );
}
