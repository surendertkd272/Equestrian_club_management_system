import Link from "next/link";
import { Button } from "@/components/ui/button";
import { guideFor } from "@/lib/onboarding/content";

// Registry-driven empty state for list screens. Drop it into a
// ResponsiveTable's `emptyMessage` slot: <FeatureEmptyState feature="/certificates" />.
// Copy comes from FEATURE_GUIDES so a new page gets a sensible first-run
// message for free, and the wording stays consistent across the app.
//
// Falls back to the feature's blurb if no dedicated emptyState is defined, and
// to a generic line if the href isn't in the registry — so it never renders blank.
export function FeatureEmptyState({ feature }: { feature: string }) {
  const guide = guideFor(feature);
  const es = guide?.emptyState;
  const title = es?.title ?? "Nothing here yet";
  const body = es?.body ?? guide?.blurb ?? "Nothing to show yet.";
  return (
    <div className="py-10 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      {es?.cta && (
        <div className="mt-3">
          <Button asChild size="sm" variant="outline">
            <Link href={es.cta.href}>{es.cta.label}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
