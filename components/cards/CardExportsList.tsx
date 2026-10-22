import { Download } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { Chip, type ChipTone } from "@/components/ui/display";

export type CardExportRow = {
  id: string;
  format: string;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  cardCount: number | null;
  byteSize: number | null;
  error: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  downloadable: boolean;
};

const FORMAT_LABELS: Record<string, string> = { sheet: "A4 print sheets", cards: "One card per page", zip: "ZIP of PDFs" };
const STATUS: Record<CardExportRow["status"], { tone: ChipTone; label: string }> = {
  PENDING: { tone: "info", label: "Waiting" },
  PROCESSING: { tone: "info", label: "Preparing" },
  DONE: { tone: "success", label: "Ready" },
  FAILED: { tone: "danger", label: "Failed" },
};
const when = (date: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
const size = (bytes: number) => (bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} kB`);

/** Bulk card exports the viewer asked for, newest first, with a download link once ready. */
export function CardExportsList({ rows }: { rows: CardExportRow[] }) {
  if (rows.length === 0) return <p className="text-body-ui text-ink-secondary">No exports yet. Choose members on the Members page, then Download cards.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {rows.map((row) => {
        const expired = row.status === "DONE" && !row.downloadable;
        return (
          <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-label text-ink">{FORMAT_LABELS[row.format] ?? row.format}{row.cardCount ? ` · ${row.cardCount} ${row.cardCount === 1 ? "card" : "cards"}` : ""}</span>
              <span className="block text-caption text-ink-muted">
                Asked for {when(row.createdAt)}
                {row.status === "FAILED" && row.error ? ` · ${row.error}` : ""}
                {row.downloadable && row.expiresAt ? ` · kept until ${when(row.expiresAt)}` : ""}
                {expired ? " · the file has been deleted" : ""}
              </span>
            </span>
            <Chip size="sm" tone={expired ? "neutral" : STATUS[row.status].tone}>{expired ? "Expired" : STATUS[row.status].label}</Chip>
            {row.downloadable ? (
              <a href={`/api/exports/cards/${row.id}`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                <Download aria-hidden className="size-4" />
                Download{row.byteSize ? ` (${size(row.byteSize)})` : ""}
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
