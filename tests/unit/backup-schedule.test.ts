import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const source = readFileSync(path.join(root, "deploy/backup.sh"), "utf8");
const functionStart = source.indexOf("database() {");
const database = source.slice(functionStart, source.indexOf("\nmc_alias()", functionStart))
  .replaceAll("/backups/", "${BACKUP_FIXTURE_DIR}/");
const scheduleStart = source.indexOf("  schedule)\n");
const schedule = source.slice(scheduleStart, source.indexOf("\n  restore)", scheduleStart))
  .replace("find /backups ", 'find "$BACKUP_FIXTURE_DIR" ');
const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";
const oldArchive = "scheduled-20240101T000000Z.sql.gz";
const newArchive = "scheduled-20261029T010203Z.sql.gz";
const sql = "CREATE TABLE recovered (id integer);\nINSERT INTO recovered VALUES (42);\n";

function scheduled(failure = "none") {
  const directory = mkdtempSync(path.join(tmpdir(), "swb-backup-schedule-"));
  try {
    writeFileSync(path.join(directory, oldArchive), gzipSync("older good backup"));
    const result = spawnSync(bash, ["-c", `set -eu
umask 077
interval_hours=24
retention_days=14
date() { printf '20261029T010203Z'; }
pg_dump() {
  [ "$FAILURE" != empty ] || return 0
  printf '%s' "$FIXTURE_SQL"
  [ "$FAILURE" != dump ]
}
gzip() {
  if [ "$FAILURE" = gzip ]; then printf 'partial compression'; return 1; fi
  command gzip "$@"
}
mv() { [ "$FAILURE" != publish ] && command mv "$@"; }
find() { printf 'pruned' > "$BACKUP_FIXTURE_DIR/retention"; }
sleep() { exit 0; }
${database}
case schedule in
${schedule}
esac`], { cwd: root, env: { ...process.env, BACKUP_FIXTURE_DIR: directory.replaceAll("\\", "/"), FAILURE: failure, FIXTURE_SQL: sql }, encoding: "utf8" });
    return {
      ...result,
      files: readdirSync(directory).sort(),
      decoded: existsSync(path.join(directory, newArchive)) ? gunzipSync(readFileSync(path.join(directory, newArchive))).toString() : null,
    };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("conditional scheduled database backups", { timeout: 30_000 }, () => {
  it.each(["dump", "empty", "gzip", "publish"])("keeps the last good archive and skips retention after %s failure", (failure) => {
    // Runs the exact scheduler's conditional function call: errexit alone is ineffective here.
    const result = scheduled(failure);
    expect(result.status, result.stderr).toBe(0); // Scheduler remains alive for its next interval.
    expect(result.stderr).toContain("Scheduled database backup failed");
    expect(result.stdout).not.toContain("Database backup:");
    expect(result.files).toEqual([oldArchive]); // No plaintext, partial archive, publication or retention call.
    expect(result.decoded).toBeNull();
  });

  it("publishes only the complete compressed dump, then permits retention", () => {
    const result = scheduled();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Database backup: backups/${newArchive}`);
    expect(result.decoded).toBe(sql);
    expect(result.files).toEqual(["retention", oldArchive, newArchive].sort());
  });
});
