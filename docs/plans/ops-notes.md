# Operations track notes (2026-10-23, branch `phase/ops`)

What the ops track delivered for owner requirement 4 (install, hosting), how each part was verified, what could
not be verified on this machine, and the lines README.md and CLAUDE.md should carry.

## Delivered

- **`install.sh`** (one file, `curl | bash`): O's preflight and fresh install kept, plus
  - private repository access: `SWB_GITHUB_TOKEN`, `GITHUB_TOKEN` or `GH_TOKEN`, else `gh auth token`; the token
    goes to curl through stdin and to sudo by name only, and to `docker login ghcr.io` (in `setup.sh` and the
    updater) before image pulls; release metadata and archives come from the API (`/releases/latest`,
    `/tarball/<ref>`), which works for private and public repositories alike;
  - `--release TAG`, `--ref REF` (build from source on the server; recorded in `.spaceworks-source-ref`, updates
    rebuild it through `scripts/update.sh --source` / `scripts/update-source.sh`), `--dir`, `--repo`;
  - the W-style maintenance menu (12 entries plus cancel) and `--action`/`--update` to run one entry unattended;
  - `--non-interactive` (`SWB_NONINTERACTIVE=1`; answers from `SWB_ANSWER_<KEY>`, the first missing or invalid
    one stops the run and is named) and `--dry-run` (checks only, no download; from a checkout it also runs the
    questions and prints the summary).
- **Menu scripts** ported from W to O's flat layout (`scripts/`): `status.sh`, `backup-settings.sh`,
  `reconfigure.sh`, `harden.sh`, `recover-admin.sh` (over `admin.sh reset-mfa|set-password|create|list`),
  `support-bundle.sh` (redacted), `uninstall.sh` (keeps volumes and `.env`/`tls`/`backups` unless `DELETE DATA`),
  a dump chooser in `restore.sh`, shared helpers in `host-lib.sh`, `repository_env_set` and the GitHub helpers in
  `spaceworks-repository.sh`. All are in the host bundle (`install-host-bundle.sh`) so updates replace them.
- **Entrypoint:** `DATABASE_URL_SSLMODE` (adds `sslmode=` to URLs that name none: Render's managed PostgreSQL), and
  it accepts its own name as the first argument, so `docker-entrypoint.sh --role …` works whether a platform keeps
  or replaces the image's ENTRYPOINT (Render `dockerCommand`/`preDeployCommand`, DigitalOcean `run_command`).
- **`render.yaml`:** managed PostgreSQL 16 (`swbook-db`, private), web `swbook-backend` (`preDeployCommand:
  docker-entrypoint.sh --role migrate`, `/api/health`), workers `swbook-worker` and `swbook-beat` (`--role
  worker|beat`), env group `swbook-shared` with `generateValue` secrets (incl. the three base64 keys), operator
  values asked once on the web service and shared to the workers with `fromService.envVarKey`, public origin
  defaulting to `RENDER_EXTERNAL_URL`. Deploy button:
  `https://render.com/deploy?repo=https://github.com/SpaceWorks-Labs/SpaceWorks-Bookings`.
- **`.do/app.yaml`** (DigitalOcean App Platform, the only other host a sibling ships: W) ported with explicit
  roles. Railway and Fly appear in W only as monitoring integrations, not as deploy targets, so nothing to port.
- **Compose:** `DATABASE_URL_SSLMODE` in both `x-app-env` blocks; the smoke now checks `/api/health` (body),
  `/api/health/db` (bearer), each of worker and beat `/health` on 3460 from inside the container, and their
  BullMQ heartbeats in Redis; `sed -i` replaced so it runs on macOS too.
- **Dockerfile:** npm cache mount and fetch retries on `npm ci` (the deps stage repeatedly failed on this
  machine's slow registry connection); stale "Scheduler" comment fixed.
- **Docs:** `DEPLOYMENT_VPS.md` (install options, private repository, unattended installs, maintenance menu,
  source updates), `DEPLOYMENT_CLOUD.md` (Render rewritten, DigitalOcean added, worker always required),
  `DEPLOYMENT_NETLIFY.md` (jobs stay on the backend, private repo access), `CONFIGURATION.md` (every variable the
  compose files, `render.yaml`, `.do/app.yaml`, the installer and scripts read; `SWB_ANSWER_*` table).
- **Tests:** `tests/unit/ops-render.test.ts`, `ops-compose.test.ts`, `ops-install.test.ts` (see below).

## Verified, and how

Run on 2026-10-24 from a Windows 11 workstation (Docker Desktop 29.9, Git Bash) and a Linux container
(`mcr.microsoft.com/playwright:v1.64.1-noble`, Node 24) for anything POSIX-only:

| Check | How | Result |
| --- | --- | --- |
| Bundled stack end to end | `SWB_COMPOSE_BUILD_LAYER=1 bash scripts/compose-smoke.sh` (builds both images from the checkout, writes a config as `setup.sh` does, starts every service, runs the `ops` checks, proves worker, beat and edge, backs up and restores) | Passed: database over TLS, runtime role can't change schema, all migrations applied, Redis over TLS with password, private bucket, readiness, worker and beat heartbeats, trigger endpoints refuse requests without the secret, SMTP relay; backup and restore finished |
| Shell scripts | `docker run koalaman/shellcheck:v0.10.0 -S warning -x install.sh setup.sh scripts/*.sh deploy/*.sh` (the CI list) | Clean |
| Installer | `bash install.sh --help`; `bash install.sh --dry-run --ref dev` in the Linux container | Help prints; the dry run passes every preflight check (architecture, OS, dependencies, disk) and reports the source build of `dev`, then stops at the first question because the container has no terminal (as designed; unattended runs use `SWB_ANSWER_*`) |
| Installer, compose and Render units | `tests/unit/ops-install.test.ts`, `ops-compose.test.ts`, `ops-render.test.ts` in the Linux container | 24 of 24 pass (`ops-install` skips on Windows by design) |
| Whole production build in a browser | `npm run test:e2e:vps -- --external-services` (standalone server, seeded demo, every Playwright spec) | Passes; signed-in journeys run, none skipped |
| Split hosting | `npm run test:e2e:split -- --external-services` (website image over the signed gateway, separate action keys) | Passes, see the B4 commit |

`render.yaml` and `.do/app.yaml` were checked statically (`ops-render.test.ts`: every production variable
`lib/env.ts` requires is set or generated, every role runs `docker-entrypoint.sh`), not against a live account.

## Not verifiable here

- **A real Render deploy.** Not done (needs the owner's Render account and the repository on `main`). Open
  questions only a deploy settles: whether Render's private PostgreSQL URL accepts `sslmode=require` (Render
  servers terminate TLS for external URLs; the internal hop is documented as "TLS not required", and community
  reports of SSL errors on internal URLs suggest TLS is negotiated there too); whether `generateValue` output is
  standard base64 (Render's docs show `B0jrphAPOY7pg92AN0c9MN4yecczLMdwnx4OkA1KFUk=`, which decodes to 32 bytes;
  URL-safe output would make the app refuse to start with a clear `MFA_ENCRYPTION_KEY` message, fixed by pasting
  `openssl rand -base64 32` values into the group); `fromService` self-reference of `RENDER_EXTERNAL_URL`.
- **Render Key Value** is deliberately not provisioned: its private URL is plain `redis://` and `lib/env.ts`
  refuses non-TLS Redis in production. If the owner wants a one-click Redis, `lib/env.ts` needs a narrow exception
  (for example: allow `redis://` when `process.env.RENDER === "true"` and the host matches `^red-[a-z0-9]+$`), then
  add a `keyvalue` service (`maxmemoryPolicy: noeviction`, `ipAllowList: []`) and
  `REDIS_URL: fromService { type: keyvalue, property: connectionString }` to each service. That is a security
  decision for the owner and lives in `lib/`, outside this track.
- **GHCR publish and a release install.** No release exists yet (`releases/latest` is 404 and `main` has no
  `install.sh`), so the default path (latest release, image pull, `docker login ghcr.io` with a token) is
  untested; `--ref` is the path that works before the first release. The token download path was checked against
  the private repository (`/tarball/dev` with a bearer token, and `gh api …/contents/install.sh?ref=dev`).
- **A real VPS run of `install.sh`** (package installation, sudo, systemd, ufw/fail2ban in `harden.sh`, the runner)
  and the interactive menu scripts (`backup-settings`, `reconfigure`, `recover-admin`, `uninstall`, the restore
  chooser) were not run on a Linux server; they pass shellcheck and their dispatch is unit-tested.
- **`.do/app.yaml`** is untested against DigitalOcean (no account); it mirrors W's spec, which W documents as working.
- **Workflows:** `.github/workflows/*` were not changed (the local `gh` token lacks the `workflow` scope). The
  `shell` job's shellcheck list (`install.sh setup.sh scripts/*.sh deploy/*.sh`) already covers the new scripts.

## For README.md and CLAUDE.md

README, "Install" section:

```markdown
### One-line install (VPS)

    curl -fsSL https://raw.githubusercontent.com/SpaceWorks-Labs/SpaceWorks-Bookings/main/install.sh | bash

While the repository is private, export a token (`repo`, `read:packages`) and pass it to curl, or use the
GitHub CLI:

    curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" https://raw.githubusercontent.com/SpaceWorks-Labs/SpaceWorks-Bookings/main/install.sh | bash
    gh api -H 'Accept: application/vnd.github.raw' repos/SpaceWorks-Labs/SpaceWorks-Bookings/contents/install.sh | bash

Run it again for the maintenance menu: update, status, backups, restore, rollback, settings, server security,
super-admin recovery, support bundle and uninstall. `--ref main` builds from source before the first release;
`--non-interactive` with `SWB_ANSWER_*` and `--dry-run` are documented in docs/DEPLOYMENT_VPS.md.

### Hosting

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/SpaceWorks-Labs/SpaceWorks-Bookings)

- One server (VPS): the installer above, docs/DEPLOYMENT_VPS.md.
- Render: render.yaml (managed PostgreSQL, web, BullMQ worker and beat; bring a TLS Redis, a bucket and SMTP),
  docs/DEPLOYMENT_CLOUD.md.
- Any Docker host with managed services: docker-compose.cloud.yml, docs/DEPLOYMENT_CLOUD.md.
- DigitalOcean App Platform: .do/app.yaml, docs/DEPLOYMENT_CLOUD.md.
- Website on Netlify, backend on a server: docs/DEPLOYMENT_NETLIFY.md.
```

CLAUDE.md, "Commands" → Operations block, replace/add:

```bash
curl -fsSL https://raw.githubusercontent.com/SpaceWorks-Labs/SpaceWorks-Bookings/main/install.sh | bash   # install, or the menu when installed
bash install.sh --help                                   # --ref REF, --release TAG, --action ACTION, --non-interactive, --dry-run
bash scripts/status.sh                                   # release, services, worker/beat health, newest backup, ops checks
bash scripts/update.sh --force [--version V | --rollback | --source REF]
```

CLAUDE.md, "Conventions" → Operations, add:

- `install.sh` is self-contained (`curl | bash`); menu entries are scripts in `scripts/` listed in
  `install-host-bundle.sh`. A private repository is reached with `SWB_GITHUB_TOKEN`/`GITHUB_TOKEN`/`GH_TOKEN` or
  `gh auth token`; never write a token to `.env`.
- `render.yaml` and `.do/app.yaml` run every role as `docker-entrypoint.sh --role …`; keep them in step with
  `docker-compose.cloud.yml` (`tests/unit/ops-render.test.ts` checks the production variables against `lib/env.ts`).
- The worker is required on every host: `/api/internal/outbox` and `/api/internal/jobs` only enqueue for it (the
  current CLAUDE.md wording "for hosts without a worker" overstates them).
