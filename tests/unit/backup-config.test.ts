import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe.skipIf(process.platform === "win32")("configuration backup filesystem modes", () => {
  it.each([false, true])("preserves usable public TLS and private key modes (overrides: %s)", (override) => {
    const work = mkdtempSync(path.join(tmpdir(), "swb-config-backup-"));
    try {
      const root = path.join(work, "install");
      const temporary = path.join(work, "temporary");
      const recovered = path.join(work, "recovered");
      for (const dir of [root, temporary, recovered]) mkdirSync(dir);
      const envFile = override ? path.join(work, "custom environment") : path.join(root, ".env");
      const tls = override ? path.join(work, "custom tls") : path.join(root, "tls");
      mkdirSync(tls, { mode: 0o755 });
      mkdirSync(path.join(tls, "redis"), { mode: 0o700 });
      writeFileSync(envFile, "DISPOSABLE_FIXTURE=1\n", { mode: 0o600 });
      writeFileSync(path.join(tls, "ca.crt"), "public certificate\n", { mode: 0o644 });
      writeFileSync(path.join(tls, "ca.key"), "private fixture\n", { mode: 0o600 });
      writeFileSync(path.join(tls, "redis/private.key"), "redis private fixture\n", { mode: 0o600 });
      chmodSync(tls, 0o755);
      const script = readFileSync("scripts/backup.sh", "utf8");
      const block = script.slice(script.indexOf("  (\n    umask 077"), script.indexOf("\n  say \"Settings and certificates:"));
      expect(block).toContain("config_stage=");
      const archive = path.join(work, "config.tar.gz");
      execFileSync("bash", ["-euo", "pipefail", "-c", block], { env: {
        ...process.env, ROOT: root, archive, TMPDIR: temporary,
        SWB_STATIC_ENV_FILE: override ? envFile : "", SWB_TLS_DIR: override ? tls : "",
      } });
      execFileSync("tar", ["-xzf", archive, "-C", recovered]);
      const mode = (file: string) => statSync(file).mode & 0o777;
      expect(mode(archive)).toBe(0o600);
      expect(mode(path.join(recovered, ".env"))).toBe(0o600);
      expect(mode(path.join(recovered, "tls"))).toBe(0o755);
      expect(mode(path.join(recovered, "tls/ca.crt"))).toBe(0o644);
      expect(mode(path.join(recovered, "tls/ca.key"))).toBe(0o600);
      expect(mode(path.join(recovered, "tls/redis/private.key"))).toBe(0o600);
      expect(readFileSync(path.join(recovered, ".env"), "utf8")).toBe("DISPOSABLE_FIXTURE=1\n");
      expect(readFileSync(path.join(recovered, "tls/ca.crt"), "utf8")).toBe("public certificate\n");
      expect(readdirSync(temporary)).toEqual([]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 30_000);
});
