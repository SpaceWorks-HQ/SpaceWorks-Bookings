import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * This product was forked from the Space Works membership platform and renamed (tenant = makerspace, prefix
 * SWB/swbook). Only NOTICE (attribution), LICENSE (the AGPL's own words), the build plan and .gitignore (a vim swap
 * file pattern) may still carry the old names. The patterns are assembled from parts so this file does not match itself.
 */
const root = join(import.meta.dirname, "../..");
const ALLOWED = [/^NOTICE$/, /^LICENSE$/, /^docs\/plans\//, /^\.gitignore$/, /^package-lock\.json$/, /\.(png|webp|jpe?g|gif|ico|pdf|woff2?|ttf|otf)$/];
const old = (...parts: string[]) => new RegExp(parts.join(""), "i");
const PATTERNS = [old("organi", "[sz]ation"), old("\\bsw", "o\\b"), old("\\bsw", "o[._:-]"), old("\\bSW", "O_"), old("sw", "org")];

describe("product names", () => {
  it("leaves none of the old product, tenant or prefix names outside the attribution", { timeout: 60_000 }, () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
    const hits = files
      .filter((file) => !ALLOWED.some((pattern) => pattern.test(file)))
      .flatMap((file) => {
        let text: string;
        try {
          text = readFileSync(join(root, file), "utf8");
        } catch {
          return [];
        }
        return text.split("\n").flatMap((line, index) => (PATTERNS.some((pattern) => pattern.test(line)) ? [`${file}:${index + 1}`] : []));
      });
    expect(hits).toEqual([]);
  });
});
