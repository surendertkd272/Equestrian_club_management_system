import { PageSkeleton } from "@/components/ui/skeleton";

// Segment-level fallback: any page below without its own loading.tsx
// shows a skeleton during server fetch instead of a frozen screen.
export default function Loading() {
  return <PageSkeleton />;
}
