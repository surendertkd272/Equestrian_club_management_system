"use client";

import { SegmentError } from "@/components/shell/segment-error";

export default function ParentError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentError {...props} home="/parent" />;
}
