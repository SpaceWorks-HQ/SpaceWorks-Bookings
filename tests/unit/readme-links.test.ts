import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");

describe("README", () => {
  it("links and images point at files that exist", () => {
    const targets = [...readme.matchAll(/(?:\]\(|src="|srcset="|href=")([^)"#\s]+)/g)].map((match) => match[1]).filter((target) => !/^(https?:|mailto:)/.test(target));
    expect(targets.length).toBeGreaterThan(20);
    for (const target of targets) expect(existsSync(path.join(process.cwd(), target)), target).toBe(true);
  });

  it("shows every screenshot it names in light and dark", () => {
    for (const [, name] of readme.matchAll(/docs\/screenshots\/([a-z-]+?)(?:-dark)?\.webp/g)) {
      expect(existsSync(path.join(process.cwd(), "docs/screenshots", `${name}.webp`)), name).toBe(true);
      expect(existsSync(path.join(process.cwd(), "docs/screenshots", `${name}-dark.webp`)), `${name}-dark`).toBe(true);
    }
  });

  it("keeps the in-page navigation pointing at real headings", () => {
    const anchors = new Set([...readme.matchAll(/^#{2,3} (.+)$/gm)].map(([, heading]) => heading.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ /g, "-")));
    for (const [, anchor] of readme.matchAll(/href="#([^"]+)"/g)) expect(anchors.has(anchor), anchor).toBe(true);
  });
});
