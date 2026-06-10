"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

// Shared body for route-segment error boundaries (app/**/error.tsx).
// Renders inside the segment's layout, so the sidebar/topbar stay up and
// the user can navigate away even when one page's data fetch blows up.
export function SegmentError({
  error,
  reset,
  home = "/dashboard",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  home?: string;
}) {
  useEffect(() => {
    // Server components log the real error server-side; this is the
    // client-visible echo (message is redacted to a digest in prod).
    console.error("[segment-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
        <h2 className="mt-4 text-lg font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This page hit an unexpected error. Your data is safe — try again, or
          head back and retry in a moment.
        </p>
        {error.digest && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        )}
        <div className="mt-5 flex items-center justify-center gap-3">
          <Button onClick={() => reset()}>Try again</Button>
          <Button variant="outline" onClick={() => (window.location.href = home)}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
