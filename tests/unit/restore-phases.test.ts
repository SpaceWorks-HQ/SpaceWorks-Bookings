import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const source = readFileSync(path.join(root, "scripts/restore.sh"), "utf8");
const block = source.slice(source.indexOf("\nstopped=0\n") + 1);
const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";

function restore(failure = "none", storage = "bundled") {
  const directory = mkdtempSync(path.join(tmpdir(), "swb-restore-phases-"));
  try {
    const result = spawnSync(bash, ["-c", `set -euo pipefail
COMPOSE=(compose)
name=manual-20261029T010203Z.sql.gz
SCRIPT_DIR=disposable-fixture
with_storage=1
say() { printf '%s\\n' "$*"; }
warn() { printf '%s\\n' "$*" >&2; }
serving_services() { SERVING_SERVICES=(backend worker beat caddy); }
repository_env_value() { printf '%s' "$STORAGE"; }
bash() { printf 'safety-backup\\n' >> "$RESTORE_FIXTURE_DIR/calls"; [ "$FAILURE" != safety ]; }
compose() {
  printf '%s\\n' "$*" >> "$RESTORE_FIXTURE_DIR/calls"
  case "$*" in
    'run --rm --no-deps -T backup restore '*)
      [ "$FAILURE" != sql ] || return 23 ;;
    'run --rm --no-deps -T backup-storage restore-storage')
      [ "$FAILURE" != storage ] || return 24 ;;
    'run --rm --no-deps -T migrate')
      [ "$FAILURE" != migration ] || return 25 ;;
    'up -d --wait --wait-timeout 300 --no-deps backend worker beat caddy')
      # Models Compose starting some containers before a migration/readiness failure.
      printf 'partially-started\\n' >> "$RESTORE_FIXTURE_DIR/calls"
      [ "$FAILURE" != readiness ] || return 26 ;;
    'run --rm --no-deps -T ops')
      [ "$FAILURE" != ops ] || return 27 ;;
  esac
  return 0
}
${block}`], { cwd: root, env: { ...process.env, RESTORE_FIXTURE_DIR: directory.replaceAll("\\", "/"), FAILURE: failure, STORAGE: storage }, encoding: "utf8" });
    return { ...result, calls: readFileSync(path.join(directory, "calls"), "utf8").trim().split("\n") };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("bundled restore failure phases", { timeout: 30_000 }, () => {
  it.each(["sql", "safety"])("restarts the original data after %s failure before database commit", (failure) => {
    const result = restore(failure);
    expect(result.status).toBe(failure === "sql" ? 23 : 1);
    expect(result.calls.at(-2)).toBe("up -d --wait --wait-timeout 300 --no-deps backend worker beat caddy");
    expect(result.calls).not.toContain("up -d --wait --wait-timeout 300 --no-deps backup backup-storage");
    expect(result.calls.some(call => call.includes("restore-storage"))).toBe(false);
    expect(result.stdout).not.toContain("Restore finished");
  });

  it.each(["storage", "migration", "readiness", "ops"])("keeps serving processes stopped after committed database plus %s failure", (failure) => {
    const result = restore(failure);
    expect(result.status).not.toBe(0);
    expect(result.calls.filter(call => call.startsWith("stop "))).toHaveLength(2);
    expect(result.calls.at(-1)).toBe("stop backend worker beat caddy backup backup-storage");
    expect(result.calls).not.toContain("up -d");
    expect(result.calls).not.toContain("up -d --wait --wait-timeout 300 --no-deps backup backup-storage");
    expect(result.stderr).toContain("Keeping the site offline");
    expect(result.stdout).not.toContain("Restore finished");
    if (failure === "readiness" || failure === "ops") expect(result.calls).toContain("partially-started");
  });

  it("resumes only after complete database, objects and readiness success", () => {
    const result = restore();
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls.filter(call => call.startsWith("stop "))).toHaveLength(1);
    expect(result.calls).toContain("run --rm --no-deps -T backup-storage restore-storage");
    expect(result.calls).toContain("run --rm --no-deps -T migrate");
    expect(result.calls).toContain("up -d --wait --wait-timeout 300 db redis minio");
    expect(result.calls).toContain("run --rm --no-deps -T createbuckets");
    expect(result.calls.indexOf("safety-backup")).toBeGreaterThan(result.calls.indexOf("stop backend worker beat caddy backup backup-storage"));
    expect(result.calls.at(-1)).toBe("up -d --wait --wait-timeout 300 --no-deps backup backup-storage");
    expect(result.calls.indexOf("run --rm --no-deps -T ops")).toBeLessThan(result.calls.indexOf(result.calls.at(-1)!));
    expect(result.stdout).toContain("Restore finished");
  });

  it("does not stop the disabled storage-backup service in external-storage mode", () => {
    const result = restore("sql", "external");
    expect(result.status).toBe(23);
    expect(result.calls[0]).toBe("stop backend worker beat caddy backup");
  });

  it("bootstraps fresh recovery with data services only so empty storage cannot erase the source mirror", () => {
    const recovery = readFileSync(path.join(root, "scripts/test-vps-recovery.sh"), "utf8");
    const bootstrap = recovery.slice(recovery.indexOf('export SWB_STATIC_ENV_FILE='), recovery.indexOf('bash scripts/restore.sh'));
    expect(bootstrap).toContain('up -d --wait --wait-timeout 600 db redis minio');
    expect(bootstrap).toContain('run --rm --no-deps -T createbuckets');
    expect(bootstrap).toContain('run --rm --no-deps -T migrate');
    const startup = bootstrap.match(/"\$\{COMPOSE\[@\]\}" up .*$/gm) ?? [];
    expect(startup.filter(command => !command.endsWith("audit-mailpit"))).toHaveLength(1);
    expect(startup.some(command => /\b(createbuckets|migrate)\b/.test(command))).toBe(false);
  });
});
