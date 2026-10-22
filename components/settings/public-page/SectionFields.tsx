"use client";

import { Plus, Trash2 } from "lucide-react";
import { LINK_KINDS, MAX_GALLERY_IMAGES, pageImageUrl, type PageSection, type SectionOf } from "@/lib/publicPage/sections";
import { Button, IconButton } from "@/components/ui/button";
import { Dropdown, Field, Input, Textarea } from "@/components/ui/field";
import { ImageUploadButton } from "./ImageUploadButton";

type Props<T extends PageSection["type"]> = { slug: string; section: SectionOf<T>; disabled: boolean; error: (path: string) => string | undefined; onChange: (next: SectionOf<T>) => void };

const LINK_LABELS: Record<(typeof LINK_KINDS)[number], string> = {
  website: "Website", instagram: "Instagram", facebook: "Facebook", x: "X", linkedin: "LinkedIn", youtube: "YouTube", github: "GitHub", whatsapp: "WhatsApp", other: "Other",
};

function Intro({ section, disabled, onChange, note }: { section: SectionOf<"plans"> | SectionOf<"units">; disabled: boolean; onChange: (intro: string) => void; note: string }) {
  return (
    <>
      <Field label="Introduction" optional helperText={note}>
        <Textarea value={section.intro} rows={2} maxLength={600} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      </Field>
    </>
  );
}

function Faq({ section, disabled, error, onChange }: Props<"faq">) {
  const set = (index: number, patch: Partial<SectionOf<"faq">["items"][number]>) => onChange({ ...section, items: section.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  return (
    <div className="flex flex-col gap-4">
      {section.items.map((item, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <div className="flex items-start gap-2">
            <Field label={`Question ${index + 1}`} className="flex-1" error={error(`items.${index}.question`)}>
              <Input value={item.question} maxLength={200} disabled={disabled} onChange={(event) => set(index, { question: event.target.value })} />
            </Field>
            <IconButton label={`Remove question ${index + 1}`} variant="quiet" className="mt-7" disabled={disabled} onClick={() => onChange({ ...section, items: section.items.filter((_, i) => i !== index) })}><Trash2 /></IconButton>
          </div>
          <Field label="Answer" error={error(`items.${index}.answer`)}>
            <Textarea value={item.answer} rows={3} maxLength={2000} disabled={disabled} onChange={(event) => set(index, { answer: event.target.value })} />
          </Field>
        </div>
      ))}
      <div><Button type="button" size="sm" variant="secondary" disabled={disabled || section.items.length >= 30} onClick={() => onChange({ ...section, items: [...section.items, { question: "", answer: "" }] })}><Plus aria-hidden className="size-4" />Add a question</Button></div>
    </div>
  );
}

function Gallery({ slug, section, disabled, onChange }: Props<"gallery">) {
  const images = section.images;
  return (
    <div className="flex flex-col gap-4">
      {images.length ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {images.map((image, index) => (
            <li key={image.key} className="flex flex-col gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded through the app's own storage route */}
              <img src={pageImageUrl(image.key)} alt="" className="aspect-[4/3] w-full rounded-lg border border-line object-cover" />
              <div className="flex items-end gap-2">
                <Field label="Describe the image" helperText="For people using screen readers." className="flex-1">
                  <Input value={image.alt} maxLength={160} disabled={disabled} onChange={(event) => onChange({ ...section, images: images.map((other, i) => (i === index ? { ...other, alt: event.target.value } : other)) })} />
                </Field>
                <IconButton label={`Remove image ${index + 1}`} variant="quiet" disabled={disabled} onClick={() => onChange({ ...section, images: images.filter((_, i) => i !== index) })}><Trash2 /></IconButton>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-body-ui text-ink-muted">No images yet.</p>}
      {images.length < MAX_GALLERY_IMAGES ? (
        <ImageUploadButton slug={slug} label="Add an image" disabled={disabled} onUploaded={(key) => onChange({ ...section, images: [...images, { key, alt: "" }] })} />
      ) : <p className="text-caption text-ink-muted">The gallery holds {MAX_GALLERY_IMAGES} images.</p>}
    </div>
  );
}

function Links({ section, disabled, error, onChange }: Props<"links">) {
  const set = (index: number, patch: Partial<SectionOf<"links">["links"][number]>) => onChange({ ...section, links: section.links.map((link, i) => (i === index ? { ...link, ...patch } : link)) });
  return (
    <div className="flex flex-col gap-4">
      {section.links.map((link, index) => (
        <div key={index} className="grid items-start gap-3 rounded-lg border border-line p-4 sm:grid-cols-[150px_1fr_auto]">
          <Field label="Kind">
            <Dropdown value={link.kind} disabled={disabled} onChange={(event) => set(index, { kind: event.target.value as typeof link.kind, label: link.label || LINK_LABELS[event.target.value as typeof link.kind] })}>
              {LINK_KINDS.map((kind) => <option key={kind} value={kind}>{LINK_LABELS[kind]}</option>)}
            </Dropdown>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Label" error={error(`links.${index}.label`)}><Input value={link.label} maxLength={60} disabled={disabled} onChange={(event) => set(index, { label: event.target.value })} /></Field>
            <Field label="Address" error={error(`links.${index}.url`)}><Input type="url" inputMode="url" value={link.url} maxLength={500} placeholder="https://" disabled={disabled} onChange={(event) => set(index, { url: event.target.value.trim() })} /></Field>
          </div>
          <IconButton label={`Remove link ${index + 1}`} variant="quiet" className="sm:mt-7" disabled={disabled} onClick={() => onChange({ ...section, links: section.links.filter((_, i) => i !== index) })}><Trash2 /></IconButton>
        </div>
      ))}
      <div><Button type="button" size="sm" variant="secondary" disabled={disabled || section.links.length >= 16} onClick={() => onChange({ ...section, links: [...section.links, { kind: "website", label: "Website", url: "" }] })}><Plus aria-hidden className="size-4" />Add a link</Button></div>
    </div>
  );
}

/** The fields for one section, by type. Every value is validated again on the server when saved. */
export function SectionFields(props: { slug: string; section: PageSection; disabled: boolean; error: (path: string) => string | undefined; onChange: (next: PageSection) => void }) {
  const { section, disabled, error, onChange } = props;
  switch (section.type) {
    case "about":
      return (
        <Field label="Text" helperText="Markdown: ## heading, **bold**, *italic*, - lists, [link](https://…). HTML isn't allowed." error={error("markdown")}>
          <Textarea value={section.markdown} rows={8} maxLength={6000} disabled={disabled} onChange={(event) => onChange({ ...section, markdown: event.target.value })} />
        </Field>
      );
    case "plans":
      return <Intro section={section} disabled={disabled} onChange={(intro) => onChange({ ...section, intro })} note="Your open plans and their prices show below it, always up to date." />;
    case "units":
      return <Intro section={section} disabled={disabled} onChange={(intro) => onChange({ ...section, intro })} note="Your units show below it, from Settings → Units and roles." />;
    case "contact":
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Email" optional error={error("email")}><Input type="email" value={section.email} maxLength={320} disabled={disabled} onChange={(event) => onChange({ ...section, email: event.target.value })} /></Field>
          <Field label="Phone" optional error={error("phone")}><Input type="tel" value={section.phone} maxLength={32} disabled={disabled} onChange={(event) => onChange({ ...section, phone: event.target.value })} /></Field>
          <Field label="Address" optional className="sm:col-span-2"><Textarea value={section.address} rows={2} maxLength={400} disabled={disabled} onChange={(event) => onChange({ ...section, address: event.target.value })} /></Field>
          <Field label="Hours" optional className="sm:col-span-2"><Input value={section.hours} maxLength={200} placeholder="Saturdays, 10am to 4pm" disabled={disabled} onChange={(event) => onChange({ ...section, hours: event.target.value })} /></Field>
        </div>
      );
    case "faq":
      return <Faq {...props} section={section} onChange={onChange} />;
    case "gallery":
      return <Gallery {...props} section={section} onChange={onChange} />;
    case "links":
      return <Links {...props} section={section} onChange={onChange} />;
    case "text":
      return (
        <Field label="Text" helperText="Plain text. Line breaks are kept." error={error("body")}>
          <Textarea value={section.body} rows={5} maxLength={4000} disabled={disabled} onChange={(event) => onChange({ ...section, body: event.target.value })} />
        </Field>
      );
  }
}
