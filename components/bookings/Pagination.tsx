import Link from "next/link";
import { Button } from "@/components/ui/button";

export function Pagination({ page, pages, query = {} }: { page: number; pages: number; query?: Record<string, string | undefined> }) {
  const href = (next: number) => `?${new URLSearchParams(Object.fromEntries(Object.entries({ ...query, page: String(next) }).filter((entry): entry is [string, string] => Boolean(entry[1]))))}`;
  return <nav aria-label="Pagination" className="flex items-center gap-3">
    {page > 1 ? <Button asChild variant="secondary"><Link href={href(page - 1)}>Previous page</Link></Button> : null}
    <span className="text-ink-muted">Page {page} of {pages}</span>
    {page < pages ? <Button asChild variant="secondary"><Link href={href(page + 1)}>Next page</Link></Button> : null}
  </nav>;
}
