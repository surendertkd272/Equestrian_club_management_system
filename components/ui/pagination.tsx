"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

// URL-driven pagination — pages own ?page= and ?pageSize=; the component just
// reads them and renders nav links. Keeps history/back-button working and
// makes list URLs shareable.
export function Pagination({
  total,
  page,
  pageSize,
  pageSizes = [25, 50, 100],
}: {
  total: number;
  page: number;
  pageSize: number;
  pageSizes?: number[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  function href(nextPage: number, nextSize?: number) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("page", String(nextPage));
    if (nextSize) sp.set("pageSize", String(nextSize));
    return `${pathname}?${sp.toString()}`;
  }

  // Clamp a stale / out-of-range ?page= (typed by hand, or left dangling after
  // rows were deleted or a filter narrowed the set) back to the last real page,
  // so the list doesn't render an empty body under "Showing 51–50 of 50".
  useEffect(() => {
    if (total > 0 && page > totalPages) {
      router.replace(href(totalPages));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, page, totalPages]);

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-3 py-2 text-xs">
      <div className="text-muted-foreground">
        {total === 0 ? (
          "No results"
        ) : (
          <>
            Showing <span className="font-medium text-foreground">{start}</span>–
            <span className="font-medium text-foreground">{end}</span> of{" "}
            <span className="font-medium text-foreground">{total}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-muted-foreground">
          Rows
          <select
            value={pageSize}
            onChange={(e) => {
              // Soft nav instead of window.location so the rest of the
              // dynamic page state (filter inputs, scroll near top) isn't
              // discarded.
              router.push(href(1, Number(e.target.value)));
            }}
            className="min-h-[36px] rounded border bg-card px-2 text-xs sm:min-h-0 sm:py-0.5"
          >
            {pageSizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <Link
          aria-disabled={prevDisabled}
          tabIndex={prevDisabled ? -1 : 0}
          href={prevDisabled ? "#" : href(page - 1)}
          className={`inline-flex min-h-[40px] items-center gap-0.5 rounded border px-3 sm:min-h-[30px] sm:px-2 ${
            prevDisabled ? "pointer-events-none opacity-40" : "hover:bg-muted"
          }`}
        >
          <ChevronLeft className="h-3 w-3" /> Prev
        </Link>
        <span className="text-muted-foreground">
          Page <span className="font-medium text-foreground">{page}</span> / {totalPages}
        </span>
        <Link
          aria-disabled={nextDisabled}
          tabIndex={nextDisabled ? -1 : 0}
          href={nextDisabled ? "#" : href(page + 1)}
          className={`inline-flex min-h-[40px] items-center gap-0.5 rounded border px-3 sm:min-h-[30px] sm:px-2 ${
            nextDisabled ? "pointer-events-none opacity-40" : "hover:bg-muted"
          }`}
        >
          Next <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

// Server-side helper lives in lib/paging.ts — a "use client" file can't
// re-export it because every export becomes a client-reference proxy.
// Server pages: `import { parsePaging } from "@/lib/paging"`.
