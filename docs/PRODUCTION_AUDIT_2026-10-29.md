# Space Works Bookings production audit — 29–30 October 2026

**Decision:** local production acceptance passed for **0.6.0**. The owner authorised gated publication through
`dev` and `main`. Actual VM/public-domain/payment-provider checks remain the deployment checklist below.
This is a tested hardening result, not a claim of zero risk or exhaustive inspection of every possible UI state.

The audit covers the standalone Bookings app, using Events as the deployment reference. PostgreSQL owns tenant
data and the outbox; Redis and BullMQ run the worker and beat; Silo supplies private S3-compatible storage.
Email and chat notifications remain worker jobs, as requested. No production database or live payment account
was used. VERSION, root/frontend manifests and all lockfile version fields agree on **0.6.0**.

## Coverage and confirmed fixes

| Area inspected | Result |
| --- | --- |
| Booking holds, approval, cancellation, expiry and late settlement | Existing booking locks, allocation locks and exclusion constraints reviewed. Confirmation now requires enough reviewed settled money for PAY_NOW or DEPOSIT. |
| Payment reservations and gateway concurrency | Closing older attempts and creating their replacement share one booking transaction. Provider HTTP runs after commit. Delayed superseded/cancelled checkouts close and request Stripe expiry. |
| Partial payments and mismatched captures | Partial payments remain held until the threshold is reached. Documents awaiting review cannot auto-confirm/revive a booking. Reviewing a held document rechecks confirmation under the booking lock without duplicating payment timeline events. |
| Refund commitments and expired revival | Pending/processed refunds and unresolved failed reservations are excluded from available funds. Expiry cannot turn partial payment into free confirmation when chargeMinor becomes zero. |
| Payment/refund lock order | Payment locks take the booking first; refund locks take the payment first. Offline transitions, failed payments/refunds, ended checkout cleanup and stale reconciliation use consistent ordering. |
| Checkout pool starvation | Gateway settings reuse the reservation transaction. Five simultaneous attempts no longer consume five connections while each waits for an unavailable sixth global-client connection. |
| Tenant boundaries, roles and MFA | Services scope locks by makerspace; staff actions resolve current membership/capabilities and require staff MFA. Wrong-tenant, payment guard and lifecycle regressions passed. Tenant isolation remains application-enforced with composite foreign keys, not PostgreSQL RLS. |
| API authority and revocation | Keys retain documented makerspace-owned independent scopes; creator identity is audit attribution. Offboarding explicitly revokes/rotates service keys. Revoked keys, insufficient scopes, foreign tenants and all five non-active tenant states reject access. |
| Tenant deletion and audit integrity | Free booking/repair history receives archive guidance. Deletion rechecks status and manager membership under a parent lock; its audit event commits only on successful deletion. Finance/paid records remain retained. |
| Financial calendar dates | Repair payouts and manual finance resolve date-only inputs at tenant-local day start. Timestamp compatibility and domain future guards remain. East/west/DST and actual action regressions cover the UTC-boundary failure. |
| Tenant-selected outbound destinations | Public-address checks, DNS pinning, TLS verification and redirect avoidance protect SMTP, Mattermost and webhooks. Mixed private/public DNS and IPv6/special-address regressions passed. |
| API request bodies | Incremental 64 KiB limits cover streamed requests and missing/misleading Content-Length. |
| Test isolation | Disposable fixture cleanup explicitly deletes tenant tables in a test-only replica transaction. Errors are no longer swallowed and disabled FK cascades cannot silently leave tenant fixtures. |

## Stack, installer and operations

| Area | Confirmed behaviour |
| --- | --- |
| Local development | Supervised one-command stack includes PostgreSQL, Redis, Silo, private bucket bootstrap and Mailpit; ports bind to loopback. Worker/beat and service probes are documented. |
| One-line install and upgrades | Self-contained install/menu, guided source setup, saved host bundle, published-app and source-build branches were reviewed. Failed login/pull/build cannot be hidden by a later successful edge build, including conditional shell callers that disable errexit. |
| Bundled web edge | Setup/upgrade/smoke build the patched Caddy source locally rather than pulling an unpublished tag. Existing-proxy mode skips that build. Recommend 4 GiB RAM with swap; the observed two-worker edge build peaked at 2.21 GiB. |
| Private source modes | Backend public and operator sources receive nextjs:nodejs ownership. CI restricts only its disposable archive to 700 directories/600 assets and actual operator files. Non-root image probes run before startup; unique fixture cleanup preserves existing checkout assets. |
| Private PostgreSQL bootstrap | A root wrapper stages readonly HBA/init inputs under the postgres UID before privilege drop. Source 600/700 modes remain private; server-owned staged HBA/init are readable/executable without world-readable permissions. |
| Runtime packaging | Both final images remove global npm/npx, retaining Node, native Sharp and isolated Prisma/operator clients. Prisma 6.19.3 retains an exact deepmerge-ts 8.0.2 security override. |
| Source/build secrets | Docker ignores TLS keys, dotenv files and installer answer transports. Builds use throwaway action keys through BuildKit secrets; installation secrets are supplied at runtime. |
| Scheduled backups | Explicit checks cover dump creation, nonempty SQL, compression and atomic publication. Failed intervals remove partials, announce failure and preserve previous archives; retention runs only after a successful replacement. |
| Truncated restore input | Decompression and SQL assembly finish in a private temporary file before transactional psql. A gzip checksum/trailer failure cannot let valid-looking partial SQL commit at EOF; the exit trap removes plaintext. |
| Restore phases | Stop traffic and both schedulers before the safety dump. After DB commit, restore objects, explicitly migrate, verify app/operator health, then restart schedulers last. Postcommit failure leaves serving offline; precommit rollback can reopen the original app while schedules stay paused. |
| Fresh-volume bootstrap | Only persistent PostgreSQL/Redis/Silo services use Compose --wait. Bucket init/migrations run explicitly as one-shot commands; an empty target cannot start a mirror scheduler that erases recovered storage. |
| Configuration archives | Backup uses the actual overridden settings/TLS paths and canonical archive names, preserves certificate modes with `cp -p`/`cp -Rp`, and keeps the outer archive 600. Scoped privileged operations handle root-owned private archives on non-root CI hosts. |

Silo and its standalone client are pinned to the October 26 release and immutable multiarch digests in local and
production Compose. Existing-proxy/external-storage branches passed configuration/behaviour checks; the actual
native stack exercised bundled edge/local Silo. The public `main` installer and future registry release tags
still need post-publication verification; current-source acceptance does not establish that an unpublished tag exists.

## Final 0.6.0 source and verification

Application/runtime source is pinned to **cdc7a67d83f03759d69e0a7a316c7fccdb70cac7**. The frozen archive SHA256 is
`f8013c9d92f037c97c9567bf1508d1f0a0dbf42b7f1c5ebf896580a988e324e5`.
An exhaustive comparison against that commit found **987/987 tracked paths present**, zero missing; `.release`
is the only added path. The final report consolidation changes documentation only, so no application rebuild
is inferred from a different source revision. External evidence lives in the parent workspace at `audit-evidence/2026-10-29/`; current Bookings logs are in
`bookings/v060/`. Scan and cross-app proof paths below are relative to that evidence root.

| Gate on final application commit | Result |
| --- | --- |
| Exact-head GitHub CI | All checks green: Tests run 40956214295; Security run 40956214078. Complete logs and summary retained. |
| Complete Linux unit suite | **1006 passed, zero skipped, 115 files passed**. |
| Complete PostgreSQL/Redis/BullMQ integrations | **184 passed, zero skipped, 34 files passed**, including concurrency, tenant/role/MFA, immutable history, migration drift and worker lifecycle checks. |
| Complete seeded browser suite | **21 passed in 6.0 minutes**, zero failed/skipped/flaky/retried. Exact Paid assertions remain; no timeout/retry masking was added to repair the date bug. |
| Lint, TypeScript, builds and bundles | All CI gates passed; native frontend/backend Next.js 16.4.2 builds also passed compilation, TypeScript and static generation using two workers. Frontend traces exclude database engines, mail, Redis and storage clients. |
| Deployment gates | ShellCheck, six Python release-helper tests, AGENTS/CLAUDE drift and 13 Compose configurations passed. No Helm charts are present. |
| Dependency security | All-dependency npm audit reports zero vulnerabilities. Isolated Prisma override compatibility passed migrations/build/runtime probes. |
| Actual native install | Real `setup.sh --build` passed on fresh configuration and volumes using the source-built 0.6.0 images. Exact runtime manifests independently report 0.6.0. |
| Restrictive runtime assets | Actual installed image passed default non-root UID/read probes for public/operator 700/600 assets and actual 600 check/admin tools. PostgreSQL private bootstrap and TLS/least-privilege checks passed. |
| Native/operator packaging | Node 22.23.4, absent global npm/npx, native Sharp PNG rendering, isolated Prisma CLI's deepmerge-ts 8.0.2 override, health/login and hidden internal-job 404 checks passed. |
| Worker email before/after restore | Verified STARTTLS relay delivery and deletion of bearer-bearing SQL outbox payloads passed both times. |
| Encrypted fresh-volume recovery | Real age off-host bundle→destroy original volumes→different empty project→restore original config/keys/data/private files→operator checks and schedulers-last all passed, exit 0. |

The recovery fixture proves initial account/object absence, removal of a target-only table, relational records,
paid ledger and immutable trigger, original MFA/payment-key decryption, original private object bytes and
anonymous 403. Its deliberately rejected paid-record mutation emits an expected Prisma constraint error that the
probe asserts. It is not an unhandled application failure.

Primary evidence: `source-coverage.json`, `pr3-cdc7a67-{tests-passed.log,security-passed.log,ci-summary.json}`,
`linux-install.log`, `linux-install.exit`, `final-app-image-ids.txt`, `final-installed-image-probes.log` and
`final-acceptance-summary.json`. The immutable primary harness completed normally. A supplemental frontend
version probe initially used the root manifest path; the correct workspace manifest probe passed separately.

### Exact installed images and residual findings

| Artifact | Actual installed immutable image ID |
| --- | --- |
| Backend 0.6.0 | `sha256:99b505fb58a34af8ccc67080ee0b3a0ad649b3aa266300a3d81805e4a148d6df` |
| Frontend 0.6.0 | `sha256:61c14f377ae2201783843af9f75026e3cca07f05313dc2c33df3279c2d49e02f` |
| Shared edge | `sha256:8ea0f80c5d8957bb672fab414a44fbeea53b764cf5a25f15e804d30c695b0d68` |

Both final application images have **zero detected findings at every severity**, unsuppressed. Exact reports:
`image-security/bookings-060-backend-runtime-final/` and `image-security/bookings-060-frontend-final/`. The preliminary backend
export 9055 has identical RootFS layers, but the final installed 99b image was scanned independently; its proof
and both reports are retained. The setup's cached Compose build changed manifest identity without recompiling.

The exact edge also received its own unsuppressed scan: **0 critical, 1 high, 2 medium, 1 unknown**, no OS findings.
Residual findings are unfixed JOSE v3 advisories and unmaintained OpenPGP; all identified fixable findings are absent.
`image-security/shared-caddy-bookings-060-final/` retains raw results and RootFS equality to historical 0956.
Configured ACME-server/JWK/OpenPGP paths are absent; this is a configured-path assessment, not removal of vulnerable
code or a complete source callgraph. The Go vulnerability DB predates the JOSE advisories, so silence is not proof
of safety. The coordinator retains the separate Silo MinIO-module identity/parser assessment and raw Silo/mc scans.

Independent proof extracted the actual installed edge binary: Go 1.26.10/Caddy 2.11.7/x-net 0.62/Chi 5.4/JOSE v4.1.6.
Generated-CA-trusted HTTPS explicitly negotiated **HTTP/2 = 2**; proxy health, trust-header sanitisation, internal
job 404, absent ACME-server route and stock-module parity passed. Evidence:
`machines/artifacts/caddy-bookings-060-final/` and `machines/logs/caddy-bookings-060-proof.{log,exit}`.

## Historical acceptance and failures retained

The preceding 0.5.1 audit candidate passed 986 Linux units/111 files and 184 integrations/34 files. Its production
monolith and separate backend/frontend browser suites each passed 21/21 journeys without skips/flakes/retries;
all 22 screenshots per layout were visually inspected. Representative captures cover public/mobile booking,
paid receipts, repair finance, team access, desk check-in and settings. Reduced-motion desktop/mobile landing
and public-room captures showed 200 responses without horizontal overflow. This does not claim every UI state.
Evidence remains in `linux-browser-{monolith,split}-results/`, their summary files and `visual-stable/`.

Historical monolith source SHA256: `6ae7f2c8296b27a1348b89f418b93040f904019f088b8a9f51ac6d7d38f87eb0`;
split SHA256: `39881c8941226fd7174f3d953369a7ad2cb9f5db291e99f5cf3b49116436f3dc`.
Historical install archive: `6059eadaca7c3eba985ec9017b106d2a545d562ff267b49aced5b26755295206`; its metadata records
working-tree provenance. Its backend b42c/frontend e867 images and earlier 0956 edge proof are **historical 0.5.1
acceptance**, not substitutes for the exact 0.6.0 images above. Initial and final raw logs remain available.

Confirmed failure evidence and corrections are retained:

- Native Windows graceful-SIGTERM expectations and resource-pressure DB failures were superseded by Linux passes.
  Missing disposable payment keys were fixed in the Linux fixture, without relaxing application guards.
- Truncated gzip, conditional scheduler failures, retention, restore rollback/postcommit isolation and one-shot
  bootstrap ordering received behavioural regressions and real packaged recovery checks.
- A TLS backup staging mode regression changed the public CA 644→600; `cp -p`/`cp -Rp` and real recovered Redis checks
  fixed it. Original failing and passing logs remain. A mutable external Bash harness also once ended incorrectly;
  later primary harnesses stayed immutable and returned 0. No application success was inferred from that error.
- First remote PR CI exposed transaction-pool starvation and non-root private-backup archive access. Original
  `pr3-first-ci-failed.log`, deterministic one-connection red/green checkout tests and privileged archive cases remain.
- The next CI passed 184 integrations and full recovery but failed payout Paid after 18:30 UTC in Kolkata. Screenshots
  and the actual future-date alert in `pr3-060-playwright/` proved a product date-conversion error. Old controllers
  fail three regressions; 20 focused date/action/domain cases passed after the fix, followed by full green CI.
- Restrictive source 700/600 exposed public, operator and PostgreSQL privilege-drop boundaries. Scoped fixtures,
  actual non-root image probes and real PostgreSQL TLS/application-role checks prove the corrections without
  weakening source permissions. Supplemental probe-path mistakes are documented separately from product failures.

The earlier c5ef359 CI passed 1005 units/115 files, 184 integrations and 21 browsers. The final cdc7a67 packaging
commit adds the operator fixture regression and passed 1006 units plus every remaining gate, as recorded above.

## Deployment staging checklist

The owner accepted clean local-stack validation and authorised gated dev→main publication. These are remaining
deployment-specific checks, not a claim that a public VM or real provider account has already been tested.

| Check | Acceptance and evidence to retain |
| --- | --- |
| Fresh VM baseline | Verify supported OS/CPU, updates, RAM/disk, Docker/Compose, UTC/NTP, install ownership and reboot/service or systemd restart. |
| Firewall/private services | Limit SSH to approved sources and expose only HTTP/HTTPS. From another host prove PostgreSQL, Redis, Silo and worker-health ports are unreachable publicly. |
| Public DNS/TLS | Verify published A/AAAA addresses, trusted hostname/chain/renewal, HTTPS redirects and application/auth origins. |
| Released artifacts | Pull exact published backend/frontend releases, record digests, migrate, run readiness/operators and verify prior-release rollback. Local source acceptance does not prove future registry tags. |
| Provider redirects/callbacks | Configure actual public payment/provider URLs and verify return/cancel/signed callbacks, cookies and proxy-origin handling. Retain redacted event IDs. |
| Payment sandbox | With provider-issued sandbox credentials test full/deposit/balance, cancellation, late/mismatched capture, refunds and failures; reconcile booking/payment/ledger/documents to provider events. No live customer charges. |
| Webhook replay | Replay signed duplicates, old/tampered signatures and out-of-order/time-out cases; prove one money/ledger effect and invalid-event rejection. |
| Real SMTP | Test authenticated verified TLS through the actual worker, production-origin links, expiry/single-use capabilities and secret-free logs. |
| SPF/DKIM/DMARC | Publish relay records and DMARC reporting/policy; verify received Authentication-Results/From alignment and inspect reports before tightening. |
| Bounce/complaint operations | Exercise relay test events for suppression, temporary failures and alerts. Generic SMTP has no universal feedback webhook here; configure provider-side suppression/monitoring and an owned response process. |
| Recovery/monitoring | Copy encrypted backups off the VM; recover original config/keys into empty volumes in data-first/schedulers-last order. Recheck ledger/private files/decryption/email and disk/backup/queue/job alerts. |

Email remains **at least once**: SMTP may accept before a worker crashes ahead of its SQL success update, so retry
can duplicate mail. Stable Message-ID helps correlation/deduplication but does not guarantee exactly once.
Outbox success means relay acceptance, not inbox delivery; provider bounce/complaint suppression remains necessary.
The existing SMTP stack is retained; no provider migration was introduced.

Native acceptance uses fresh configuration/projects/volumes on the existing Linux Docker daemon, not a separate
fresh VM, public DNS/Let's Encrypt issuance, systemd host installation or live gateway round trips. Original raw
failures, source hashes, final image identities and representative screenshots remain retained outside the repo.
