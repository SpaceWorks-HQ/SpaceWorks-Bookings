# Space Works Bookings production audit — 29–30 October 2026

This audit covers the standalone Bookings app, using Events as the deployment reference. PostgreSQL owns tenant
data and the outbox; Redis and BullMQ run the worker and beat; Silo supplies S3-compatible storage. Email and chat
notifications remain worker jobs, as requested. No production database or live payment account was used.

## Coverage and confirmed fixes

| Area inspected | Result |
| --- | --- |
| Booking holds, approval, cancellation, expiry and late settlement | Existing booking locks, space allocation locks and exclusion constraints reviewed. Confirmation now requires enough reviewed settled money for PAY_NOW or DEPOSIT. |
| Payment reservations and gateway concurrency | Closing older attempts and creating their replacement now share the booking transaction. Provider HTTP calls run after commit. A delayed superseded or cancelled checkout is closed and Stripe is asked to expire it. |
| Underpayments, deposits and mismatched captures | Partial payments stay held until the required threshold is reached. Captures whose documents await review do not automatically confirm or revive a booking. Reviewing a held document rechecks confirmation under the booking lock without a duplicate payment timeline event. |
| Refund commitments and expired revival | Pending refunds, processed refunds and unresolved failed refund reservations are excluded from funds available to confirm. Expiry cannot turn a partial payment into a free confirmed booking merely because chargeMinor became zero. |
| Payment/refund lock order | Shared payment locks now take the booking first; refund locks take their payment first. This covers offline confirmation/rejection/cancellation, failed payments and failed refunds whose status triggers write booking totals. Ended checkout cleanup rechecks booking state under the same lock; stale reconciliation uses the shared helper. |
| Tenant boundaries, roles and MFA | Booking services scope their locks by makerspace. Staff actions resolve membership and capabilities; staff need MFA. Existing staff-action, wrong-tenant, payment guard and lifecycle regressions exercised. |
| Tenant deletion and audit integrity | Free booking and repair history now receives archive guidance. Deletion rechecks tenant status and manager membership under a parent lock. The deletion audit event commits only with successful deletion. Finance and paid payment records remain retained. |
| Tenant-selected SMTP, Mattermost and webhook destinations | Coordinator hardened public-address validation, DNS pinning, redirect avoidance and TLS verification. Mixed public/private DNS answers and special-address variants have targeted regressions. |
| API request bodies | Coordinator added an incremental 64 KiB body limit, including requests without a useful Content-Length header. |
| Local services | Coordinator aligned the local Compose stack with PostgreSQL, Redis, Silo, private bucket bootstrap and Mailpit. Ports bind to loopback; configuration and README describe the local stack and worker/beat commands. |
| Test isolation | Fixture teardown now explicitly deletes tenant tables in a disposable database transaction with test-only replica mode. Cleanup errors are no longer swallowed, and disabled FK cascades cannot silently leave tenant fixtures behind. |

## Expanded Linux and recovery acceptance

The owner subsequently required complete Linux/browser and fresh-install/recovery acceptance before a dev push
or patch PR. The reproducible run uses a Git-visible snapshot of the current working source, including version
0.5.1 changes, in an isolated Linux runner with official Node 22 and Chromium. Logs and the source archive hash
are kept in `../audit-evidence/2026-10-29/bookings`. Final results and exact runtime images are recorded below.

Preparation uncovered and fixed two additional boundaries:

- Source builds now exclude `tls/` and `.spaceworks-*` from their Docker context. This prevents private service
  keys and the installer's temporary answer/password transport from entering builder layers or caches.
- Configuration backups now archive the actual `SWB_STATIC_ENV_FILE` and `SWB_TLS_DIR`, with canonical archive
  names. Disposable acceptance stacks using overrides cannot accidentally archive a checkout's unrelated settings.

The remaining toolchain advisory is now patched with an exact `deepmerge-ts` 8.0.2 override while retaining Prisma
6.19.3. A lockfile audit reports **zero vulnerabilities**. The isolated migration CLI image carries the same
override policy. Prisma's installed loader uses the retained named `deepmerge` API for configuration records;
the completed Linux migration/integration/build checks validated compatibility. The upstream advisory concerns
recursive JavaScript object graphs, rather than ordinary JSON. See the
[reviewed advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) and
[upstream release notes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0).

The new guarded `scripts/test-vps-recovery.sh` exercises the real backup/restore scripts, wraps the database,
private objects and configuration in an age-encrypted off-host bundle, destroys source volumes, recovers into a
different project with empty PostgreSQL/Silo volumes, and checks relational records, the paid ledger and its
immutable trigger, original object bytes/privacy, and decryption through the application's actual MFA/payment
crypto helpers. CI's bundled-stack job opts into this recovery gate. A fixture SMTP relay can additionally prove
verified STARTTLS worker delivery and deletion of bearer-bearing outbox payloads before and after recovery.

This local acceptance uses fresh Docker projects/configuration/volumes on the existing Linux Docker daemon.
It does not represent a separate freshly provisioned VM, public DNS/Let's Encrypt issuance, systemd installation,
or a published release artifact that does not yet contain these working-tree changes.

### Linux quality and database gates completed

The isolated Node 22.23.4 / npm 10.9.9 runner completed these gates against the then-current 0.5.1 audit source (historical acceptance):

| Gate | Recorded result |
| --- | --- |
| Clean lockfile installation and Prisma schema validation | Passed; Prisma 6.19.3 retained with deepmerge-ts 8.0.2. |
| AGENTS.md / CLAUDE.md drift, complete ESLint and TypeScript | Passed. |
| Complete unit suite | **986 passed, zero skipped, 111 files passed**, including backup/restore, configuration permissions and conditional installer/edge failure cases. Linux executed installer cases skipped on Windows. |
| Complete PostgreSQL/Redis integration suite | **184 passed, zero skipped, 34 files passed** on the final source, including the five inactive-tenant API additions. Includes migrations/schema drift, authenticated tenant boundaries, booking/payment/refund races, immutable history and worker/beat health with graceful SIGTERM. |
| Worker, beat and guarded recovery-probe bundles | Passed. |
| ShellCheck and release helper tests | Passed; **6 Python tests passed**. |
| Every CI Compose configuration | Passed: six bundled layer/storage combinations in published-image and source-build modes, plus cloud (**13 configurations**). No Helm charts are present. |
| All-dependency npm audit | **Zero vulnerabilities at every severity** in both the patched lockfile and installed Linux tree. |
| Monolith production build and complete browser suite | **21 passed, zero skipped/flaky/retried/failed**, after the Next.js 16.4.2 production build passed compilation, TypeScript and static-page generation using two workers. Every journey captured a screenshot. |
| Separate backend/frontend builds and complete split browser suite | **21 passed, zero skipped/flaky/retried/failed**. Both production builds and TypeScript passed; frontend dependency traces exclude database engines, mail, Redis and storage clients. Separate action keys and credential isolation were exercised. |

The first Linux integration run passed 177 tests; two webhook fixtures lacked the generated payment encryption
key that CI normally supplies. The acceptance harness now generates disposable AUTH/CRON/MFA/payment keys, and
the entire suite passed on rerun. Initial and final logs are both retained in the evidence directory. No
application guard was relaxed. These results supersede the earlier Windows process-signal failures and the
earlier unpatched toolchain advisory; live gateway round trips remain outside these synthetic tests.

The supported `ALLOW_PLAIN_HTTP=1` installer mode exposed a separate delivery mismatch: authentication outbox
handlers rejected their own configured HTTP links in production. The validator now permits only the configured
HTTP origin when this mode is explicitly enabled (or both CI test guards are enabled), while rejecting URL
credentials and foreign HTTP hosts/ports. **19 new URL/handler regressions** passed; the full unit suite, lint,
typecheck and bundles passed again, followed by **14/14 affected authentication/notification integration tests**.
The real worker SMTP probe now derives its verification link from the installed public origin to exercise this
mode during installer acceptance. Guidance reviewed: the installed email-best-practices skill's transactional
email and sending-reliability references; the product's explicitly supported plain-HTTP trial mode is retained.

Evidence note: the final quality rerun completed every individual gate successfully, then its outer shell
returned 1 because its external harness was edited while Bash was reading it, changing the continuation offset.
That harness error is retained in `linux-quality.exit`; it is not an application test failure. The initial full
quality invocation returned 0, the final unit JSON records 957 passes, and the subsequent affected-integration
invocation used the stable harness and returned 0. Future long invocations keep their harness immutable.

The complete monolith browser run executed all **21 journeys**, including seeded manager/front-desk, team and
external technician repair, payment/receipt, MFA, public booking/ICS, mobile, approval, check-in and settings
flows. All passed without skips or retries in 6.3 minutes. The frozen archive SHA-256 was
`6ae7f2c8296b27a1348b89f418b93040f904019f088b8a9f51ac6d7d38f87eb0`. Full results and screenshots are in
`audit-evidence/2026-10-29/bookings/linux-browser-monolith-results/`; the summary JSON records zero failures.
All 22 successful browser screenshots were visually inspected, covering public/mobile booking, paid receipts,
repair finance, team access, desk check-in and settings. Three additional captures reused the compiled server
with reduced motion: `visual-stable/landing-desktop.png`, `landing-mobile.png` and `public-room-mobile.png`.
Each route returned 200 without horizontal overflow. This is representative visual evidence, not a claim that
every possible application state has been inspected.

The earlier shared Docker daemon outage occurred before Bookings' heavy phases. After authorized engine
recovery, both hosting layouts validated `experimental.cpus: 2` with two page-generation workers. The complete
split suite also passed all **21 journeys** in 6.1 minutes against archive SHA-256
`39881c8941226fd7174f3d953369a7ad2cb9f5db291e99f5cf3b49116436f3dc`; all 22 captured screenshots were reviewed.
Evidence is in `linux-browser-split-summary.json` and `linux-browser-split-results/`. Final source-image installation
and encrypted empty-volume recovery subsequently passed as recorded below.

### Truncated backup protection

Review of the shared restore contract uncovered a second failure boundary in Bookings: a truncated gzip can
emit complete valid SQL and then fail its checksum. Piping that producer directly into transactional psql can
still let psql commit at EOF before the decompressor failure is observed. `deploy/backup.sh` now finishes
decompression and SQL assembly in a private temporary file before invoking `psql -X` with ON_ERROR_STOP and
one transaction; its exit trap removes the temporary plaintext.

Both focused behavioral regressions passed: a valid compressed fixture applies with the transaction flags,
while a real gzip with its checksum/trailer removed emits no psql invocation. Bash syntax and test lint were
checked separately. These cases were subsequently included in the complete 986-test unit pass and the actual
packaged install/encrypted recovery acceptance below.

### Scheduled backup and restore failure phases

Peer review confirmed that POSIX shell `set -e` is disabled inside `database()` when the scheduler calls it
conditionally. The database backup now explicitly checks dump creation, nonempty SQL, compression and atomic
publication, removes its uniquely named private intermediates on failure, and runs retention only after a
successful replacement backup. A failed interval preserves the previous good archives and emits no success.

Restore now pauses serving processes and both bundled backup schedulers before its safety dump, marks the
database commit boundary, restores objects, explicitly applies current migrations, and verifies serving health
and operator checks before resuming schedulers. Before commit, failure can restart the original app while backup
schedules stay paused to protect the recovery source. After commit, file, migration or readiness failure stops
serving processes again and leaves them offline for repair/retry. The fresh-volume recovery harness starts only
database/Redis/Silo/bucket/migration dependencies, proves fixture account/object absence, and checks that restore
removes a target-only table; an empty Silo can no longer erase the recovered source via its mirror scheduler.

Focused behavioral tests cover conditional failed/empty dumps, failed gzip/publication, retention preservation,
SQL/safety-dump failure recovery, object/migration/readiness/operator failure isolation, successful ordering and
external-storage service selection. **16/16 focused native regressions passed**, followed by the full Linux
**973/973 unit pass**, complete lint/typecheck, worker/beat/recovery bundles and all-script ShellCheck. Native
shell startup exceeded Vitest's default five-second timeout under Windows paging; shell-process regression files
use a 30-second test timeout. Evidence is in `backup-restore-regressions.json`, `linux-final-units-results.json`,
`linux-final-lint.log`, `linux-final-typecheck.log` and `linux-final-jobs.log`. Final packaged recovery subsequently
passed on the hardened images below.

The final restore bootstrap separately starts only persistent PostgreSQL/Redis/Silo services with Compose
`--wait`; bucket initialization and migrations run as explicit one-shot commands. A completed one-shot service
cannot make the bootstrap health wait fail or substitute for migrations against a restored database. After this
correction, all **16/16 focused Linux backup/restore regressions** and changed-script ShellCheck passed again;
see `linux-final-backup-restore-results.json` and `linux-final-backup-restore.log`.

API keys retain their documented makerspace-owned independent scope; the creator is audit attribution, so staff
offboarding must explicitly revoke or rotate service keys. Documentation now states this contract. The actual
PostgreSQL API integration file passed **8/8 tests**, including new read/write rejection for all five non-active
makerspace states and existing revoked-key, scope and foreign-tenant checks. Evidence is
`linux-final-api-integrations-results.json`. The subsequent complete final integration run passed **184/184**
in 58 seconds; its JSON and log are `linux-integration-results.json` and `linux-integration.log`.

### Configuration recovery permissions and runtime images

The subsequent encrypted fresh-volume drill found a real backup defect: staging TLS with `cp -R` under umask 077
changed the public CA from 644 to 600. Restored non-root Redis could not read it. Staging now preserves original
permissions with `cp -p` / `cp -Rp`, while the outer archive remains 600. Both real copy/tar regressions passed,
and an actual restored Redis container changed from a TLS permission failure to healthy TLS/NOAUTH. The complete
unit suite then passed **975/975**; evidence is `linux-final-units-after-config-results.json` and
`recovered-redis-fixed-probe.log`. Final encrypted recovery subsequently passed on the hardened images below.

The complete initial recovery then **passed**, using the real scripts: age-encrypted off-host bundle, original
volumes destroyed, different project with empty PostgreSQL/Redis/Silo, fixture-absence proof, actual SQL/object
restore, target-only table removal, usable original MFA/payment keys, paid ledger/immutable trigger, original
private-object bytes and anonymous 403, followed by worker STARTTLS email and all operator checks. Evidence is
`linux-initial-runtime-after-configfix.log`. This run used the earlier image/service revisions; it does not prove
the subsequent runtime-tooling removal or October 26 service pins; the final acceptance below repeats those checks.

The shared runtime image scan also found vulnerable global npm tooling inherited from Node's base image. Final
backend and frontend stages now remove global npm/npx, retaining Node and the isolated Prisma/operator clients.
Final rebuilt-image scanning, runtime packaging probes and installed recovery acceptance confirmed this change.
Silo and the standalone `pgsty/mc` client now default to the verified October 26 release with immutable multiarch
digests in local and production Compose. Historical research notes retain the versions originally surveyed.

The shared Caddy security-build sources are included in setup, upgrades, smoke and the saved host runtime bundle.
Published-app installs build this edge locally instead of pulling an unpublished tag; existing-proxy installs skip
it. Explicit failure guards prevent a failed app pull/build from being hidden by a later successful edge build,
including conditional shell callers that disable errexit. **18/18 focused checks**, changed-file lint/ShellCheck
and **all 13 Compose configurations** passed, followed by **986/986 complete units**. Evidence is
`linux-edge-installation-results.json`, `linux-final-deployment-config.log` and
`linux-final-units-after-edge-results.json`. Bundled-edge installs/upgrades recommend 4 GiB RAM with swap;
the observed two-worker edge build peaked at 2.21 GiB. Final image scan and hardened-stack results follow.

### Final hardened images and complete recovery — passed

Real current-source `setup.sh --build` and the complete encrypted fresh-volume drill **passed, exit 0**.
Evidence: `linux-install.log`, `linux-install.exit` and `final-app-image-ids.txt`. The runtime used:

| Artifact | Exact immutable loaded image ID |
| --- | --- |
| Backend | `sha256:b42c33e96f03231b5dddb2145d54bd3d56ff98be50dd88916441b69054a68d6e` |
| Frontend | `sha256:e86798fffe6eb79c1710696c56237abd5a04a01e0be5707993dac0fbb689fcc2` |
| Shared edge | `sha256:0956bb7459167ed6f47cc9fbb29e2d3ddb452f7ba1b7313f175a1ebd74c91293` |

Both application image scans report **zero detected findings at every severity**, without suppression; see
`../image-security/bookings-backend-final/` and `../image-security/bookings-frontend-final-r2/`. Actual runtime
probes confirmed global npm/npx absence in both images, usable Node 22.23.4, native Sharp PNG rendering and
the isolated Prisma CLI's deepmerge-ts 8.0.2. Scanner results describe detected packages, not every hidden bundle.

The real clean installation passed TLS DB/Redis, least-privilege runtime role, migrations, private October Silo,
worker/beat health, admin creation and edge checks. The age-encrypted off-host bundle then recovered original
configuration/TLS after destroying source volumes and creating a different project with proven-empty targets.
Actual SQL/object restore removed a target-only table, recovered original private bytes (anonymous 403), and
preserved usable original MFA/payment keys, paid ledger and immutable trigger. The intentionally rejected paid
mutation emits a Prisma constraint error that the probe asserts. Real STARTTLS worker mail and bearer-row
deletion passed both before and after recovery; operator checks passed before backup schedules resumed.

Independent checks of the exact final edge binary confirmed Go 1.26.10/Caddy 2.11.7/x-net 0.62/Chi 5.4/JOSE v4.1.6,
standard-module parity, trusted generated-CA HTTPS explicitly negotiating **HTTP/2 = 2**, proxy health, internal
job 404, sanitized trust headers and absent ACME-server route. Evidence: `../machines/caddy-final/`.
The unsuppressed edge scan retains **0 critical, 1 high, 2 medium, 1 unknown**, no OS findings: unfixed JOSE v3
advisories and unmaintained OpenPGP. All identified fixable findings are absent. Raw scan evidence is in
`../image-security/shared-caddy-final/`; configured-path and binary-symbol limits are in `docker/caddy/README.md`.
The Go vulnerability database predates the JOSE advisories, so its silence is not proof of safety. No complete
source callgraph or removal of the vulnerable dependency code is claimed. The coordinator separately retains
the October Silo MinIO-module identity/parser assessment and raw Silo/mc scans in the combined audit.

Base install archive SHA256: `6059eadaca7c3eba985ec9017b106d2a545d562ff267b49aced5b26755295206`.
It includes uncommitted changes over `175231faa786ac52087e67f72847cd1ca9c5cc85`; `source.json` records provenance.
Two subsequent test-only Windows Git Bash portability changes were copied into the backend context; its complete
TypeScript check and **11/11 native fixture cases** passed (`native-edge-fixture-final-results.json`). Final Go
input hashes are separately retained in `final-edge-source-sha256.txt`. Report/edge README consolidation follows
runtime acceptance and does not require rebuilding application images. Original failures remain preserved.

This proves clean config/volumes on the existing Docker daemon, not a new VM. Source images were tested before
publication; future public installer downloads and registry tags remain deployment checks. Actual final runtime
used bundled edge/local Silo; existing-proxy/external-storage branches passed configuration/behavior checks.

### Deployment staging checklist

The owner accepted clean local-stack validation for this audit. The following deployment-specific checks are
documented staging work, not an approval blocker or an assertion that a public VM has already been tested.

| Check | Acceptance and evidence to retain |
| --- | --- |
| Fresh VM baseline | On the intended supported Linux/CPU architecture, verify OS updates, available RAM/disk, Docker/Compose versions, correct UTC/NTP, dedicated install ownership and restart after host reboot. Record versions and successful service/systemd restart. |
| Firewall and private services | Allow administrative SSH only from approved sources plus public HTTP/HTTPS. From a separate host, verify PostgreSQL, Redis, Silo admin/API and worker-health ports are unreachable publicly. Retain firewall rules and scan results. |
| Public DNS and TLS | Resolve production A/AAAA records to the intended edge, test both address families actually published, verify trusted certificate chain/hostname/renewal, HTTPS redirects and the configured application/auth origin. Retain DNS and TLS diagnostics without secrets. |
| Released artifacts | After publication, pull the exact release backend/frontend images on that VM, record immutable digests, run migrations and operator/readiness checks, and verify the previous-release rollback procedure. Local source-image acceptance does not prove a future registry tag exists. |
| Provider redirects and callbacks | Configure the exact public application URLs in OAuth/payment dashboards; verify return, cancel and signed callback routes, session cookies and forwarded-origin handling through the actual reverse proxy. Retain redacted provider event IDs. |
| Payment sandbox | With provider-issued sandbox credentials, exercise full/deposit/balance payment, cancellation, late capture, amount/currency mismatch review, refund and failed/refunded retries; match booking/payment/ledger/documents to provider events. Never use live customer charges for this check. |
| Webhook replay | Replay the same correctly signed sandbox event and an old or tampered signature; verify one settlement/refund/ledger effect, rejection of invalid events, and correct behavior when events arrive out of order or the gateway times out. |
| Real SMTP | Configure the chosen authenticated TLS relay, verify certificate/STARTTLS enforcement and test transactional mail through the actual worker. Check links use the production origin, expiry and single-use capabilities work, and secrets/tokens stay out of logs. |
| Sender-domain authentication | Publish the relay's SPF and DKIM records and the domain's DMARC policy/reporting address; verify received Authentication-Results and alignment with the visible From domain. Keep redacted DNS/header evidence and inspect the DMARC reports before tightening policy. |
| Bounce and complaint operations | Use the relay's documented test destinations/events to verify hard-bounce/complaint suppression, temporary-failure handling and operator alerts. Generic SMTP has no universal provider-feedback webhook in this app; configure provider-side suppression/monitoring and an owned response process before public sending. |
| Recovery and monitoring | Copy an encrypted backup off the VM, recover original configuration/keys into empty database/object volumes, follow data-first/schedulers-last order, and verify payments/ledger/private files/key decryption plus a worker email after recovery. Check alerts for disk capacity, failed backups, queue stalls and failed jobs. |

Email delivery remains **at least once**: a relay can accept SMTP before a worker crashes ahead of the SQL success
update, so a retry can duplicate mail. Stable Message-ID values help correlation and relay deduplication but do
not guarantee exactly-once delivery. Outbox success means relay acceptance, not inbox delivery; provider bounce,
complaint and suppression monitoring remain necessary. The existing SMTP stack is retained.

## Release follow-up - 0.6.0

The owner selected **0.6.0** for publication; VERSION, root/frontend manifests and lockfile workspace versions
now agree. The functional/image/install/recovery results above belong to the preceding 0.5.1 audit candidate,
not an already validated 0.6.0 release. Final 0.6.0 CI and image acceptance remain pending.

Independent native-image validation found that backend public assets copied as root can retain private 700/600
modes from a restrictive checkout umask, causing non-root Next.js startup to fail. The backend COPY now assigns
nextjs:nodejs ownership, matching the frontend. Source-build CI creates one isolated 700/600 public fixture,
checks default-user image ownership/read access directly, and then runs the full stack/recovery smoke. Existing
checkout assets are never chmodded; non-CI/published-image runs do not create this fixture, and cleanup removes
only its unique generated directory. Focused permission/helper checks are recorded separately below.

The first remote PR CI exposed real connection-pool starvation: five reservation transactions held all five
connections while gateway settings used the global client and needed a sixth. Gateway reads now reuse the
reservation transaction. A deliberately one-connection regression fails with the original code and passes all
three checkout cases with the fix, retaining the five-attempt/one-open/four-cancelled assertions and timeouts.
Evidence: `060-checkout-pool-red.json` and `060-checkout-pool-green.json`. The same CI found its non-root runner
could not archive root-owned private container backups. Scoped `as_root` file operations now preserve private
modes through archive/extraction/comparison/cleanup. The failed CI logs remain in `pr3-first-ci-failed.log`.

Follow-up checks passed: full native TypeScript, changed-file ESLint, all three changed-script ShellChecks,
**13 focused unit cases** (one POSIX-mode case skipped on Windows) and a separate actual Linux700/600 guard/
cleanup probe. Privilege/archive cases exercise both root and delegated paths without opening backup modes.
Final 0.6.0 image and complete CI results remain pending, including the new restrictive-public image probe.

The next CI passed all 184 integrations and full container recovery, then exposed a real payout date bug after
18:30 UTC: Kolkata's next calendar day was parsed as future UTC midnight. Repair/manual-finance actions now
resolve date-only inputs at tenant-local day start; timestamp compatibility and domain future guards remain.
All **20 focused tests passed**, including east/west/DST, actual action wiring and real future rejection; old
controllers fail three deterministic regressions. Exact Paid browser assertions are unchanged. Evidence:
`060-financial-date-{red-results,results}.json` and `pr3-060-playwright/` (the screenshot/error alert confirms it).

PostgreSQL had the same private-source ownership boundary: its root wrapper now stages read-only HBA/init
inputs under the postgres UID before dropping privileges. CI restricts only a disposable source copy to600/700.
Actual PostgreSQL16 testing passed source-mode preservation, UID reads/init, application-role TLS and plaintext
rejection (`v060/pg-private-probe.log`); its exact disposable container/volume were removed. ShellCheck passed.
