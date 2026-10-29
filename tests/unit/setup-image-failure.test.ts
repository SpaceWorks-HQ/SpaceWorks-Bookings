import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("setup.sh", "utf8").replaceAll("\r\n", "\n");
const start = source.indexOf('if [[ "$BUILD_FROM_SOURCE" == 1 ]]; then\n  say');
const end = source.indexOf("\n\n# 2. Private CA", start);
const fetchImages = source.slice(start, end);
const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";

function attempt(build: boolean, failure = "") {
  return spawnSync(bash, ["-s"], {
    encoding: "utf8", timeout: 15_000,
    env: { NODE_ENV: "test", PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
    input: `set -euo pipefail
BUILD_FROM_SOURCE=${build ? "1" : "0"}
failure=${failure}
say() { :; }
die() { printf '%s\\n' "$*" >&2; exit 1; }
ghcr_login() { echo login; [[ "$failure" != login ]]; }
compose() { printf '%s\\n' "$*"; [[ "$failure" != "$1" ]]; }
build_web_edge() { echo edge; [[ "$failure" != edge ]]; }
COMPOSE=(compose)
fetch_images() {
${fetchImages}
}
# A conditional caller disables errexit inside the entire function body.
if fetch_images; then echo started; fi
`,
  });
}

describe("setup image failures", () => {
  it.each([[false, "login"], [false, "pull"], [true, "build"]] as const)("refuses startup after an earlier image failure (%s, %s)", (build, failure) => {
    expect(start).toBeGreaterThan(0);
    const result = attempt(build, failure);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).not.toContain("edge");
    expect(result.stdout).not.toContain("started");
  });

  it("refuses startup after the edge fails", () => {
    const result = attempt(false, "edge");
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).not.toContain("started");
  });

  it.each([false, true])("builds the edge before startup for published/source app mode %s", (build) => {
    const result = attempt(build);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n").slice(-2)).toEqual(["edge", "started"]);
    if (!build) expect(result.stdout).toContain("pull --quiet --ignore-buildable");
  });
});
