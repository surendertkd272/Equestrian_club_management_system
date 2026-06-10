"use client";

import { SegmentError } from "@/components/shell/segment-error";

export default function StudentError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentError {...props} home="/student" />;
}
