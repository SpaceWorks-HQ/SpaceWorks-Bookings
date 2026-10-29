import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const source = readFileSync(path.join(root, "deploy/backup.sh"), "utf8");
const begin = source.indexOf("  restore)\n");
const block = source.slice(begin, source.indexOf("\n  storage)", begin))
  .replace('file="/backups/', 'file="$BACKUP_FIXTURE_DIR/');
const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";

function restore(truncate = false) {
  const directory = mkdtempSync(path.join(tmpdir(), "swb-restore-"));
  try {
    const compressed = gzipSync("CREATE TABLE public.recovered (id integer);\nINSERT INTO public.recovered VALUES (42);\n");
    writeFileSync(path.join(directory, "fixture.sql.gz"), truncate ? compressed.subarray(0, compressed.length - 8) : compressed);
    const result = spawnSync(bash, ["-c", `set -euo pipefail
umask 077
psql() {
  printf '%s' "$*" > "$BACKUP_FIXTURE_DIR/arguments"
  cat > "$BACKUP_FIXTURE_DIR/applied.sql"
}
case "$1" in
${block}
esac`, "--", "restore", "fixture.sql.gz"], { cwd: root, env: { ...process.env, BACKUP_FIXTURE_DIR: directory.replaceAll("\\", "/") }, encoding: "utf8" });
    return { ...result, applied: existsSync(path.join(directory, "applied.sql")) ? readFileSync(path.join(directory, "applied.sql"), "utf8") : null,
      arguments: existsSync(path.join(directory, "arguments")) ? readFileSync(path.join(directory, "arguments"), "utf8") : null };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("bundled database restore", { timeout: 30_000 }, () => {
  it("applies a completely decoded archive through one error-stopping transaction", () => {
    const result = restore();
    expect(result.status, result.stderr).toBe(0);
    expect(result.applied).toContain("DROP SCHEMA IF EXISTS public CASCADE;");
    expect(result.applied).toContain("INSERT INTO public.recovered VALUES (42);");
    expect(result.applied).toContain("ALTER DEFAULT PRIVILEGES FOR ROLE swbook");
    expect(result.arguments).toContain("-X -v ON_ERROR_STOP=1 --single-transaction");
  });

  it("never calls psql when a gzip emits valid SQL but fails its missing checksum", () => {
    const result = restore(true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unexpected end/i);
    expect(result.applied).toBeNull();
    expect(result.arguments).toBeNull();
  });
});
