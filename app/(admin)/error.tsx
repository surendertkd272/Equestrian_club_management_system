"use client";

import { SegmentError } from "@/components/shell/segment-error";

// Catches render/data errors from any admin page so a single failed query
// degrades to a retry card instead of white-screening the whole shell.
export default function AdminError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentError {...props} home="/dashboard" />;
}
