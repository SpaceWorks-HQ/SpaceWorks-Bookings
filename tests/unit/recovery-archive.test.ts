import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const windowsBash = "C:/Program Files/Git/bin/bash.exe";
const bash = process.platform === "win32" && existsSync(windowsBash) ? windowsBash : "bash";

describe("private recovery archive privileges", () => {
  it.each(["0", "1001"])("archives private backup entries with the correct UID%s privilege path", (uid) => {
    const root = mkdtempSync(path.join(tmpdir(), "swb-recovery-archive-"));
    try {
      const unix = (name: string) => path.join(root, name).replaceAll("\\", "/");
      mkdirSync(unix("backups"), { mode: 0o700 });
      mkdirSync(unix("backups/storage"), { mode: 0o700 });
      for (const name of ["manual.sql.gz", "config.tar.gz", "storage/private.bin"]) writeFileSync(unix(`backups/${name}`), "private fixture", { mode: 0o600 });
      const source = readFileSync("scripts/test-vps-recovery.sh", "utf8");
      const helper = source.match(/^as_root\(\).*$/m)?.[0];
      const tar = source.match(/^as_root tar -cf - .* storage \\$/m)?.[0].replace(/ \\$/, "");
      expect(helper).toBeDefined(); expect(tar).toBeDefined();
      const commands = 'id() { printf "%s\\n" "$TEST_UID"; }\nsudo() { printf "%s\\n" "$*" >> "$TRACE"; shift 2; "$@"; }';
      const result = spawnSync(bash, ["-euo", "pipefail", "-c", `${commands}\n${helper}\n${tar} > "$ARCHIVE"\ntar -tf - < "$ARCHIVE"`], {
        encoding: "utf8", env: { ...process.env, NODE_ENV: "test", TEST_UID: uid, TRACE: unix("trace"), ARCHIVE: unix("archive.tar"), original_backups: unix("backups"), dump: "manual.sql.gz", config: "config.tar.gz" },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("manual.sql.gz");
      expect(result.stdout).toContain("storage/private.bin");
      if (uid === "0") expect(existsSync(unix("trace"))).toBe(false);
      else expect(readFileSync(unix("trace"), "utf8")).toContain("-n -- tar -cf -");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
