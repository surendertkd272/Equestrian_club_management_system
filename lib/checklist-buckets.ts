// Group checklist items into section buckets and order BOTH the items within a
// bucket and the buckets themselves by orderIndex. Display order then follows
// the authoritative orderIndex regardless of how section labels are spelled
// ("A"/"B" from the template editor, "1 · …"/"2 · …" from the seeded coach
// checklist, or anything an admin types). Items with no section bucket under "—".
export function bucketsBySection<T extends { section: string | null; orderIndex: number }>(
  items: T[],
): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = it.section ?? "—";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(it);
  }
  // Items inside each bucket, in orderIndex order.
  for (const list of map.values()) list.sort((a, b) => a.orderIndex - b.orderIndex);
  // Buckets by their lowest orderIndex (= first item, since each list is sorted).
  return Array.from(map.entries()).sort(([, a], [, b]) => a[0].orderIndex - b[0].orderIndex);
}
