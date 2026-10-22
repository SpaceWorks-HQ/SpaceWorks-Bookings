"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { IdCard } from "lucide-react";
import { requestCardExport } from "@/app/actions/cards";
import { Button, buttonClasses } from "@/components/ui/button";
import { Radio, RadioGroup } from "@/components/ui/choice";
import { Callout } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type { CardExportFilter, CardExportFormat } from "@/lib/cards/exportFilter";

const FORMATS: Array<{ value: CardExportFormat; label: string; description: string }> = [
  { value: "sheet", label: "A4 print sheets", description: "Cards on A4 pages with crop marks, each front beside its back. For a home printer or a print shop." },
  { value: "cards", label: "One card per page", description: "Card-size pages for a PVC card printer." },
  { value: "zip", label: "ZIP of PDFs", description: "One PDF per member, named by card number. Up to 300 cards." },
];

/** Start a background export of the cards of the members the directory is showing. */
export function CardExportButton({ slug, filter, description }: { slug: string; filter: CardExportFilter; description: string }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<CardExportFormat>("sheet");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startTransition] = useTransition();
  const close = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (!next) setResult(null);
  };
  return (
    <>
      <Button variant="secondary" startIcon={<IdCard />} onClick={() => setOpen(true)}>Download cards</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent size="sm">
          <DialogHeader title="Download cards" description={`Cards for ${description}. We prepare the file in the background; it's ready in a minute or two.`} />
          <DialogBody className="flex flex-col gap-4">
            {result ? (
              <Callout tone={result.ok ? "success" : "danger"} role={result.ok ? "status" : "alert"}>{result.text}</Callout>
            ) : (
              <RadioGroup value={format} onValueChange={(value) => setFormat(value as CardExportFormat)} aria-label="File" className="gap-4">
                {FORMATS.map((item) => <Radio key={item.value} value={item.value} label={item.label} description={item.description} />)}
              </RadioGroup>
            )}
          </DialogBody>
          <DialogFooter>
            {result?.ok ? (
              <Link href={`/dashboard/${slug}/settings/cards`} className={buttonClasses({ variant: "primary" })}>Go to card downloads</Link>
            ) : (
              <>
                <Button variant="secondary" onClick={() => close(false)} disabled={busy}>Cancel</Button>
                <Button
                  variant="primary"
                  loading={busy}
                  onClick={() => startTransition(async () => {
                    const response = await requestCardExport({ organisationSlug: slug, format, filter });
                    setResult(response.ok
                      ? { ok: true, text: `Preparing ${response.data?.count ?? 0} ${response.data?.count === 1 ? "card" : "cards"}. Find the file under Settings, Cards.` }
                      : { ok: false, text: response.error });
                  })}
                >
                  Prepare download
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
