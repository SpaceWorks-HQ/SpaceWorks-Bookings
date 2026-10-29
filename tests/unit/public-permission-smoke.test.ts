import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";
const helper = path.resolve("scripts/smoke-public-permissions.sh").replaceAll("\\", "/");

function fixture(operation: (root: string) => void) {
  const root = mkdtempSync(path.join(tmpdir(), "swb-public-permissions-"));
  try {
    mkdirSync(path.join(root, "public"));
    writeFileSync(path.join(root, "public/existing.txt"), "existing asset");
    operation(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function run(root: string, ci: string, build: string, body: string) {
  return spawnSync(bash, ["-euo", "pipefail", "-c", `source "$HELPER"\n${body}`], {
    encoding: "utf8", env: { ...process.env, NODE_ENV: "test", ROOT: root.replaceAll("\\", "/"), HELPER: helper, CI: ci, SWB_COMPOSE_BUILD_LAYER: build },
  });
}

describe("restrictive public permission image fixture", () => {
  it.each([["false", "1"], ["true", "0"]])("does not mutate checkout assets outside source-build CI (%s/%s)", (ci, build) => {
    fixture((root) => {
      const result = run(root, ci, build, 'prepare_public_permission_probe; test -z "$PUBLIC_PERMISSION_PROBE"; remove_public_permission_probe');
      expect(result.status, result.stderr).toBe(0);
      expect(readdirSync(path.join(root, "public"))).toEqual(["existing.txt"]);
      expect(readFileSync(path.join(root, "public/existing.txt"), "utf8")).toBe("existing asset");
    });
  });

  it.skipIf(process.platform === "win32")("creates real700/600 inputs and removes only its unique fixture", () => {
    fixture((root) => {
      const result = run(root, "true", "1", `prepare_public_permission_probe
        test "$(stat -c %a "$PUBLIC_PERMISSION_PROBE")" = 700
        test "$(stat -c %a "$PUBLIC_PERMISSION_PROBE/readable.txt")" = 600
        test "$(cat "$PUBLIC_PERMISSION_PROBE/readable.txt")" = 'private-mode public asset'
        remove_public_permission_probe`);
      expect(result.status, result.stderr).toBe(0);
      expect(readdirSync(path.join(root, "public"))).toEqual(["existing.txt"]);
    });
  });

  it("refuses cleanup of an unrelated public directory", () => {
    fixture((root) => {
      mkdirSync(path.join(root, "public/unrelated"));
      writeFileSync(path.join(root, "public/unrelated/readable.txt"), "keep");
      const result = run(root, "true", "1", 'PUBLIC_PERMISSION_PROBE="$ROOT/public/unrelated"; remove_public_permission_probe');
      expect(result.status).toBe(1);
      expect(readFileSync(path.join(root, "public/unrelated/readable.txt"), "utf8")).toBe("keep");
    });
  });

  it("checks the actual default-user image before starting the full smoke stack", () => {
    const script = readFileSync("scripts/compose-smoke.sh", "utf8");
    expect(script.indexOf("prepare_public_permission_probe\n")).toBeLessThan(script.indexOf('build backend ||'));
    expect(script.indexOf("check_public_permission_probe\n")).toBeGreaterThan(script.indexOf('build backend ||'));
    expect(script.indexOf("check_public_permission_probe\n")).toBeLessThan(script.indexOf('up -d --wait'));
    expect(readFileSync("Dockerfile", "utf8")).toContain("COPY --from=builder --chown=nextjs:nodejs /app/public ./public");
  });
});
