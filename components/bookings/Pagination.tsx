import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Previous and next links for a paged list; nothing at all when everything fits on one page. */
export function Pagination({ page, pages, query = {} }: { page: number; pages: number; query?: Record<string, string | undefined> }) {
  if (pages <= 1) return null;
  const href = (next: number) => `?${new URLSearchParams(Object.fromEntries(Object.entries({ ...query, page: String(next) }).filter((entry): entry is [string, string] => Boolean(entry[1]))))}`;
  return <nav aria-label="Pagination" className="flex flex-wrap items-center gap-3">
    {page > 1 ? <Button asChild variant="secondary"><Link href={href(page - 1)}><ChevronLeft aria-hidden className="size-[18px]" />Previous page</Link></Button> : null}
    <span className="text-ink-muted">Page {page} of {pages}</span>
    {page < pages ? <Button asChild variant="secondary"><Link href={href(page + 1)}>Next page<ChevronRight aria-hidden className="size-[18px]" /></Link></Button> : null}
  </nav>;
}
