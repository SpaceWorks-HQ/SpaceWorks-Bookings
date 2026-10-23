import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The curl installer (install.sh), driven through its own flags: --help, the maintenance menu's actions and the
 * non-interactive questions, all with --dry-run, which checks the host and changes nothing.
 */
const root = join(import.meta.dirname, "../..");
const work = mkdtempSync(join(tmpdir(), "swbook-install-test-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

// A fixed token keeps the installer from asking the GitHub CLI for one; dry runs never send it.
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/^(SWB_|GITHUB_TOKEN$|GH_TOKEN$)/.test(key)),
) as NodeJS.ProcessEnv;
baseEnv.SWB_GITHUB_TOKEN = "test_token_for_dry_runs";

function install(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("bash", [join(root, "install.sh"), ...args], { env: { ...baseEnv, ...env }, encoding: "utf8", timeout: 60_000 });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const ACTION_SCRIPTS: Record<string, string> = {
  status: "status.sh",
  backup: "backup.sh",
  "backup-settings": "backup-settings.sh",
  restore: "restore.sh",
  reconfigure: "reconfigure.sh",
  harden: "harden.sh",
  "recover-admin": "recover-admin.sh",
  support: "support-bundle.sh",
  runner: "install-runner.sh",
  "runner-remove": "install-runner.sh --remove",
  uninstall: "uninstall.sh",
};

function fakeInstall(name: string, sourceRef?: string) {
  const dir = join(work, name);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, ".spaceworks-version"), sourceRef ? "local\n" : "0.1.0-main.1.0123456789ab\n");
  if (sourceRef) writeFileSync(join(dir, ".spaceworks-source-ref"), `${sourceRef}\n`);
  for (const script of new Set(["update.sh", ...Object.values(ACTION_SCRIPTS).map((entry) => entry.split(" ")[0])])) {
    writeFileSync(join(dir, "scripts", script), "exit 99\n");
  }
  return dir;
}

const answers = {
  SWB_NONINTERACTIVE: "1",
  SWB_ANSWER_HTTPS_MODE: "2",
  SWB_ANSWER_PUBLIC_DOMAIN: "book.example.org",
  SWB_ANSWER_TLS_EMAIL: "ops@example.org",
  SWB_ANSWER_SUPER_ADMIN_EMAIL: "admin@example.org",
  SWB_ANSWER_SUPER_ADMIN_PASSWORD: "a-long-enough-password",
  SWB_ANSWER_SMTP_USER: "relay-user",
  SWB_ANSWER_SMTP_PASSWORD: "relay-password",
};

describe.skipIf(process.platform === "win32")("install.sh", { timeout: 180_000 }, () => {
  it("explains every option, menu action and the private-repository fallbacks in --help", () => {
    const { status, out } = install(["--help"]);
    expect(status).toBe(0);
    for (const flag of ["--repo", "--dir", "--release", "--ref", "--action", "--update", "--non-interactive", "--dry-run"]) expect(out).toContain(flag);
    for (const action of [...Object.keys(ACTION_SCRIPTS), "update", "rollback", "cancel"]) expect(out).toContain(action);
    expect(out).toContain('curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN"');
    expect(out).toContain("gh api -H 'Accept: application/vnd.github.raw'");
    expect(out).toContain("gh repo clone SpaceWorks-HQ/SpaceWorks-Bookings");
    expect(out).toMatch(/PAYMENT_SECRETS_KEY.*\n?.*MFA_ENCRYPTION_KEY|MFA_ENCRYPTION_KEY[\s\S]*PAYMENT_SECRETS_KEY/);
  });

  it("refuses unknown options, unknown actions and --release with --ref", () => {
    expect(install(["--bogus"]).status).toBe(64);
    expect(install(["--action", "explode"]).out).toContain("Unknown action 'explode'");
    expect(install(["--release", "v0.1.0-main.1.0123456789ab", "--ref", "main"]).out).toContain("either --release or --ref");
    expect(install(["--release", "latest"]).out).toContain("--release needs a published main release");
  });

  it("maps every maintenance action to its installed script", () => {
    const dir = fakeInstall("existing");
    for (const [action, script] of Object.entries(ACTION_SCRIPTS)) {
      const { status, out } = install(["--dir", dir, "--action", action, "--dry-run", "--non-interactive"]);
      expect(status, out).toBe(0);
      expect(out).toContain(`Dry run: would run scripts/${script}`);
      expect(existsSync(join(root, "scripts", script.split(" ")[0])), script).toBe(true);
    }
    expect(install(["--dir", dir, "--update", "--dry-run", "--yes"]).out).toContain(`would update ${dir}`);
    expect(install(["--dir", dir, "--action", "rollback", "--dry-run", "--yes"]).out).toContain("would roll");
    expect(install(["--dir", dir, "--action", "cancel", "--yes"]).out).toContain("Cancelled");
    expect(readFileSync(join(dir, ".spaceworks-version"), "utf8")).toBe("0.1.0-main.1.0123456789ab\n");
  });

  it("rebuilds a source install's ref on update and refuses a rollback there", () => {
    const dir = fakeInstall("source", "dev");
    expect(install(["--dir", dir, "--update", "--dry-run", "--yes"]).out).toContain("(rebuilding dev)");
    const rollback = install(["--dir", dir, "--action", "rollback", "--dry-run", "--yes"]);
    expect(rollback.status).toBe(1);
    expect(rollback.out).toContain("no earlier release to roll back to");
  });

  it("needs an installation for a maintenance action", () => {
    const { status, out } = install(["--dir", join(work, "missing"), "--action", "status", "--dry-run", "--yes"]);
    expect(status).toBe(1);
    expect(out).toContain("No Space Works Bookings installation");
  });

  it("answers the deployment questions from SWB_ANSWER_* without changing anything", () => {
    const dir = join(work, "fresh");
    const { status, out } = install(["--dir", dir, "--ref", "main", "--dry-run"], answers);
    expect(status, out).toBe(0);
    expect(out).toContain("would install SpaceWorks-HQ/SpaceWorks-Bookings at main, built from source");
    expect(out).toContain("HTTPS: automatic Caddy HTTPS; storage: bundled Silo");
    expect(out).toContain("Server: https://book.example.org");
    expect(out).toContain("Dry run complete; nothing was changed.");
    expect(out).not.toContain("a-long-enough-password");
    expect(out).not.toContain("relay-password");
    expect(existsSync(dir)).toBe(false);
  });

  it("stops on a missing or invalid non-interactive answer and names the variable", () => {
    const invalid = install(["--dir", join(work, "invalid"), "--dry-run"], { ...answers, SWB_ANSWER_HTTPS_MODE: "9" });
    expect(invalid.status).toBe(1);
    expect(invalid.out).toContain("Set SWB_ANSWER_HTTPS_MODE");
    const withoutPassword = Object.fromEntries(Object.entries(answers).filter(([key]) => key !== "SWB_ANSWER_SMTP_PASSWORD"));
    const missing = install(["--dir", join(work, "missing-answer"), "--dry-run"], withoutPassword);
    expect(missing.status).toBe(1);
    expect(missing.out).toContain("Set SWB_ANSWER_SMTP_PASSWORD");
  });
});

describe.skipIf(process.platform === "win32")("repository_env_set", () => {
  it("replaces or appends one value and keeps the settings file owner-only", () => {
    const dir = mkdtempSync(join(work, "env-"));
    const file = join(dir, ".env");
    writeFileSync(file, "BACKUP_INTERVAL_HOURS='24'\nSMTP_HOST='old.example.org'\n", { mode: 0o600 });
    const script = `source "${root}/scripts/spaceworks-repository.sh"
repository_env_set SMTP_HOST smtp.example.org
repository_env_set BACKUP_RETENTION_DAYS 30
printf '%s|%s' "$(repository_env_value SMTP_HOST)" "$(repository_env_value BACKUP_RETENTION_DAYS)"`;
    const result = spawnSync("bash", ["-c", script], { env: { ...baseEnv, ROOT: dir }, encoding: "utf8" });
    expect(result.stdout).toBe("smtp.example.org|30");
    expect(readFileSync(file, "utf8")).toBe("BACKUP_INTERVAL_HOURS='24'\nSMTP_HOST='smtp.example.org'\nBACKUP_RETENTION_DAYS='30'\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
