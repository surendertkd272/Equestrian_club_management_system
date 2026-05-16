// Server-side paging helper. Lives outside any "use client" boundary so
// Server Components can read URL search params and derive Prisma's skip/take.
// The matching <Pagination/> renderer lives in components/ui/pagination.tsx
// and is "use client" — server pages import this; client renderers import
// the component. Splitting them avoids the "use client" infection that
// turns parsePaging into a non-callable client reference.

export function parsePaging(
  searchParams: Record<string, string | string[] | undefined>,
  defaults: { pageSize?: number } = {},
) {
  const rawPage = Number(searchParams.page);
  const rawSize = Number(searchParams.pageSize);
  const pageSize =
    Number.isFinite(rawSize) && rawSize > 0 ? Math.min(rawSize, 200) : defaults.pageSize ?? 25;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
