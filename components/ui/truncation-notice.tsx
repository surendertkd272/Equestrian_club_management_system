// Shown above a list that hard-caps its query (take: N) so users know older
// rows exist beyond the cap, instead of silently believing they see everything.
// Renders nothing when nothing is hidden. Token-aware (works in dark mode).
export function TruncationNotice({
  shown,
  total,
  noun = "records",
}: {
  shown: number;
  total: number;
  noun?: string;
}) {
  if (total <= shown) return null;
  return (
    <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      Showing the {shown} most recent of {total} {noun}. Use filters or search to narrow the list.
    </div>
  );
}
