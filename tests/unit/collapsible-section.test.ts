import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentProps, type FC } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CollapsibleSection, readSectionChoice, saveSectionChoice } from "@/components/ui/collapsible";

/** The section with children passed the JSX way (as createElement's extra arguments). */
const Section = CollapsibleSection as unknown as FC<Omit<ComponentProps<typeof CollapsibleSection>, "children">>;

const render = (props: { empty?: boolean; count?: number }) =>
  renderToStaticMarkup(createElement(Section, { id: "overview-setup", title: "Get set up", ...props }, createElement("p", null, "Body")));

describe("collapsible dashboard sections", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts open when it has items and folded when empty, with the count in the header", () => {
    const open = render({ count: 3 });
    expect(open).toContain('aria-expanded="true"');
    expect(open).toMatch(/<button[^>]*aria-controls="([^"]+)"[\s\S]*<div id="\1"(?![^>]*hidden)/);
    expect(open).toContain(">3</span>");
    const folded = render({ empty: true, count: 0 });
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).toMatch(/<div id="[^"]+" hidden=""/);
  });

  it("keeps actions outside the toggle button", () => {
    const html = renderToStaticMarkup(createElement(Section, { id: "x", title: "Issues", actions: createElement("a", { href: "/issues" }, "View all") }, "Body"));
    const button = html.slice(html.indexOf("<button"), html.indexOf("</button>"));
    expect(button).not.toContain("View all");
    expect(html).toContain('<a href="/issues">View all</a>');
  });

  it("remembers the choice per browser under swb:dash and survives storage that throws", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) } });
    expect(readSectionChoice("today-room")).toBeNull();
    saveSectionChoice("today-room", false);
    expect(store.get("swb:dash:today-room")).toBe("closed");
    expect(readSectionChoice("today-room")).toBe(false);
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
    expect(readSectionChoice("today-room")).toBeNull();
    expect(() => saveSectionChoice("today-room", true)).not.toThrow();
  });
});
