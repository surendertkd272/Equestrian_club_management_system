"use client";

import { SegmentError } from "@/components/shell/segment-error";

export default function OwnerError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SegmentError {...props} home="/owner" />;
}
