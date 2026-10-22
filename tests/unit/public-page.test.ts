import { describe, expect, it } from "vitest";
import { checkAccentContrast } from "@/lib/publicPage/contrast";
import { markdownToPlainText, parseInline, parseMarkdown } from "@/lib/publicPage/markdown";
import { documentImageKeys, isPageImageKeyFor, isSafeLink, MAX_SECTIONS, newSection, pageDocumentSchema, readPageDocument, starterDocument } from "@/lib/publicPage/sections";

const ORG = "org_abc123";
const KEY = `organisations/${ORG}/page-images/3f2b8c1e-1d2a-4c3b-9a8b-7c6d5e4f3a2b.webp`;
const doc = (sections: unknown[], extra: Record<string, unknown> = {}) => ({ tagline: "", coverAssetKey: null, accentColor: null, sections, ...extra });

describe("public page sections", () => {
  it("accepts every section type with sensible defaults", () => {
    const sections = (["about", "plans", "units", "contact", "faq", "gallery", "links", "text"] as const).map((type, index) => newSection(type, `section${index}`));
    const parsed = pageDocumentSchema.safeParse(doc(sections, { tagline: "Makers of Kochi", accentColor: "#ff7447" }));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.accentColor).toBe("#FF7447");
    expect(parsed.data?.sections.map((section) => section.type)).toEqual(["about", "plans", "units", "contact", "faq", "gallery", "links", "text"]);
  });

  it("refuses links that could run script, and keeps web, mail and phone links", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>", "vbscript:x", "//evil.test", "ftp://files.test"]) {
      expect(isSafeLink(url)).toBe(false);
      const links = { ...newSection("links", "linkssect"), links: [{ kind: "other", label: "Bad", url }] };
      expect(pageDocumentSchema.safeParse(doc([links])).success).toBe(false);
    }
    for (const url of ["https://spaceworks.test/join", "http://example.test", "mailto:hello@spaceworks.test", "tel:+91 484 000 0000"]) expect(isSafeLink(url)).toBe(true);
  });

  it("only takes page images in the upload key shape, and checks they belong to the organisation", () => {
    const gallery = (key: string) => ({ ...newSection("gallery", "gallerysec"), images: [{ key, alt: "Members at the workshop" }] });
    expect(pageDocumentSchema.safeParse(doc([gallery(KEY)])).success).toBe(true);
    expect(pageDocumentSchema.safeParse(doc([gallery("../../etc/passwd")])).success).toBe(false);
    expect(pageDocumentSchema.safeParse(doc([gallery(`organisations/${ORG}/organisation-logos/3f2b8c1e-1d2a-4c3b-9a8b-7c6d5e4f3a2b.webp`)])).success).toBe(false);
    expect(isPageImageKeyFor(KEY, ORG)).toBe(true);
    expect(isPageImageKeyFor(KEY, "org_other")).toBe(false);
    const parsed = pageDocumentSchema.parse(doc([gallery(KEY)], { coverAssetKey: KEY }));
    expect(documentImageKeys(parsed)).toEqual([KEY, KEY]);
  });

  it("refuses duplicate section ids, too many sections and over-long text", () => {
    expect(pageDocumentSchema.safeParse(doc([newSection("text", "samesame1"), newSection("about", "samesame1")])).success).toBe(false);
    expect(pageDocumentSchema.safeParse(doc(Array.from({ length: MAX_SECTIONS + 1 }, (_, index) => newSection("text", `text${String(index).padStart(4, "0")}`)))).success).toBe(false);
    expect(pageDocumentSchema.safeParse(doc([], { tagline: "x".repeat(161) })).success).toBe(false);
    expect(pageDocumentSchema.safeParse(doc([], { accentColor: "red" })).success).toBe(false);
  });

  it("reads a stored document leniently, dropping only the broken sections", () => {
    const stored = doc([newSection("about", "aboutsect"), { id: "brokenone", type: "script", visible: true, title: "" }, { ...newSection("links", "linksabcd"), links: [{ label: "x", url: "javascript:1" }] }]);
    expect(readPageDocument(stored).sections.map((section) => section.id)).toEqual(["aboutsect"]);
    expect(readPageDocument(null)).toEqual({ tagline: "", coverAssetKey: null, accentColor: null, sections: [] });
  });

  it("starts a first draft with about, plans and contact from the organisation profile", () => {
    let n = 0;
    const starter = starterDocument({ description: "We build things.", contactEmail: "hello@spaceworks.test", contactPhone: null }, () => `starter${n++}x`);
    expect(starter.sections.map((section) => section.type)).toEqual(["about", "plans", "contact"]);
    expect(starter.sections[0]).toMatchObject({ markdown: "We build things." });
    expect(starter.sections[2]).toMatchObject({ email: "hello@spaceworks.test", phone: "" });
    expect(pageDocumentSchema.safeParse(starter).success).toBe(true);
  });
});

describe("page markdown", () => {
  it("parses headings, paragraphs, lists, quotes and inline marks", () => {
    const blocks = parseMarkdown("## About us\nWe meet **every** Saturday.\nBring *tools*.\n\n- Woodwork\n- Electronics\n\n1. Apply\n2. Pay\n\n> Build things.");
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "list", "list", "quote"]);
    expect(blocks[1]).toEqual({ type: "paragraph", children: [{ type: "text", value: "We meet " }, { type: "strong", children: [{ type: "text", value: "every" }] }, { type: "text", value: " Saturday." }, { type: "break" }, { type: "text", value: "Bring " }, { type: "em", children: [{ type: "text", value: "tools" }] }, { type: "text", value: "." }] });
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ type: "text", value: "Woodwork" }], [{ type: "text", value: "Electronics" }]] });
    expect(blocks[3]).toMatchObject({ ordered: true });
  });

  it("keeps raw HTML as plain text and drops unsafe link targets", () => {
    const html = parseInline('<script>alert("x")</script> <img src=x onerror=alert(1)>');
    expect(html).toEqual([{ type: "text", value: '<script>alert("x")</script> <img src=x onerror=alert(1)>' }]);
    expect(parseInline("[click](javascript:alert(1))")).toEqual([{ type: "text", value: "click" }]);
    expect(parseInline("[wiki](https://en.wikipedia.org/wiki/Kochi_(city))")).toEqual([{ type: "link", href: "https://en.wikipedia.org/wiki/Kochi_(city)", children: [{ type: "text", value: "wiki" }] }]);
    expect(parseInline("[site](https://spaceworks.test)")).toEqual([{ type: "link", href: "https://spaceworks.test", children: [{ type: "text", value: "site" }] }]);
  });

  it("leaves underscores inside words alone and limits nesting", () => {
    expect(parseInline("snake_case_name")).toEqual([{ type: "text", value: "snake_case_name" }]);
    expect(parseInline("_one_")).toEqual([{ type: "em", children: [{ type: "text", value: "one" }] }]);
    expect(parseInline("`**not bold**`")).toEqual([{ type: "code", value: "**not bold**" }]);
  });

  it("flattens to plain text for descriptions", () => {
    expect(markdownToPlainText("## Hello\n**Makers** of [Kochi](https://k.test)\n- one\n- two")).toBe("Hello Makers of Kochi one two");
  });
});

describe("accent contrast check", () => {
  it("passes the brand teal and ink, and warns for light accents that fade on the page", () => {
    expect(checkAccentContrast("#006E63").level).toBe("pass");
    expect(checkAccentContrast("#142C2A").level).toBe("pass");
    const yellow = checkAccentContrast("#FFD84D");
    expect(yellow.level).toBe("warn");
    expect(yellow.light).toBeLessThan(3);
  });

  it("always finds a readable button label", () => {
    for (const hex of ["#777777", "#FF7447", "#B5CDFF", "#000000", "#FFFFFF", "#3A7BD5"]) expect(checkAccentContrast(hex).label).toBeGreaterThanOrEqual(4.5);
  });
});
