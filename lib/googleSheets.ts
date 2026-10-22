import "server-only";

import { MAX_CSV_BYTES } from "@/lib/csv";

export class SheetImportError extends Error {
  override name = "SheetImportError";
}

/**
 * Turn a Google Sheets link into its CSV export address. Only docs.google.com spreadsheet links are
 * accepted; the tab (gid) in the link is kept so the right sheet is read.
 */
export function sheetCsvUrl(link: string): string {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new SheetImportError("Paste the full link to the Google Sheet.");
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") throw new SheetImportError("Only Google Sheets links (docs.google.com) can be imported.");
  const match = /^\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(url.pathname);
  if (!match) throw new SheetImportError("That isn't a Google Sheets link.");
  const gid = url.searchParams.get("gid") ?? /gid=(\d+)/.exec(url.hash)?.[1] ?? "0";
  if (!/^\d{1,12}$/.test(gid)) throw new SheetImportError("That sheet tab link isn't valid.");
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
}

const ALLOWED_FINAL_HOSTS = [/^docs\.google\.com$/, /\.googleusercontent\.com$/];

/**
 * Fetch a shared sheet as CSV. The sheet must be shared as "anyone with the link can view"; a private
 * sheet answers with a sign-in page, which is reported as such. Size and time are capped.
 */
export async function fetchSheetCsv(link: string): Promise<string> {
  const exportUrl = sheetCsvUrl(link);
  let response: Response;
  try {
    response = await fetch(exportUrl, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { Accept: "text/csv" } });
  } catch {
    throw new SheetImportError("Google Sheets didn't respond. Try again in a minute.");
  }
  const finalHost = new URL(response.url || exportUrl).hostname;
  if (!ALLOWED_FINAL_HOSTS.some((pattern) => pattern.test(finalHost))) throw new SheetImportError("The sheet link redirected somewhere unexpected.");
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || type.includes("text/html")) {
    throw new SheetImportError("We couldn't read that sheet. In Google Sheets choose Share, then set General access to \"Anyone with the link\" (Viewer).");
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_CSV_BYTES) throw new SheetImportError("That sheet is too large to import at once (2 MB at most).");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CSV_BYTES) {
      await reader.cancel();
      throw new SheetImportError("That sheet is too large to import at once (2 MB at most).");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}
