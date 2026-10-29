#!/usr/bin/env bash
# shellcheck disable=SC2034 # the answers are read by write_setup_environment
# Disposable end-to-end check of the bundled stack, used by CI and before releases:
# writes a configuration exactly as setup.sh does (plain HTTP, bundled Silo), makes
# the private CA, starts every service through scripts/spaceworks-compose.sh, runs
# the operator checks, proves the job worker, beat and edge, backs up and restores the
# database, then removes the stack, its volumes and its files.
#   SWB_IMAGE_TAG=<tag> bash scripts/compose-smoke.sh     use already built/pulled images
#   SWB_COMPOSE_BUILD_LAYER=1 bash scripts/compose-smoke.sh   build from this checkout
# Its own project name (swbook-smoke) and port (18080) keep it apart from real stacks.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
say() { printf '[compose smoke] %s\n' "$*"; }
die() { printf '[compose smoke] ERROR: %s\n' "$*" >&2; exit 1; }
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

port="${SWB_SMOKE_PORT:-18080}"
work="$(mktemp -d)"
export SWB_COMPOSE_PROJECT="${SWB_COMPOSE_PROJECT:-swbook-smoke}"
work_host="$(host_path "$work")"
export SWB_STATIC_ENV_FILE="$work_host/.env" SWB_TLS_DIR="$work_host/tls" SWB_BACKUP_DIR="$work_host/backups"
export SWB_IMAGE_TAG="${SWB_IMAGE_TAG:-local}"
COMPOSE=("$SCRIPT_DIR/spaceworks-compose.sh" bundled)
cleanup() {
  local status=$?
  if [[ "$status" != 0 ]]; then "${COMPOSE[@]}" ps -a || true; "${COMPOSE[@]}" logs --tail 60 || true; fi
  "${COMPOSE[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  # Files written by root inside containers are removed by a container too.
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(host_path "$work"):/work" alpine:3 sh -c 'rm -rf /work/* /work/.env' >/dev/null 2>&1 || true
  rm -rf -- "$work"
  exit "$status"
}
trap cleanup EXIT

# The answers setup.sh would collect, written by its own environment writer.
# shellcheck source=scripts/setup-question-input.sh
source "$SCRIPT_DIR/setup-question-input.sh"
# shellcheck source=scripts/spaceworks-repository.sh
source "$SCRIPT_DIR/spaceworks-repository.sh"
# shellcheck source=scripts/setup-write-environment.sh
source "$SCRIPT_DIR/setup-write-environment.sh"
RUN_FRONTEND=1 SITE_ORIGIN='' HTTPS_MODE=1 WEBHOST=swbook.localhost TLS_EMAIL='' STORAGE=1
SUPER_ADMIN_EMAIL=admin@example.test EMAIL_FROM='Space Works Bookings <noreply@example.test>'
SMTP_HOST=smtp.example.test SMTP_PORT=587 SMTP_USER=smoke SMTP_PASSWORD="$(rand_key 24)"
GOOGLE_CLIENT_ID='' GITHUB_CLIENT_ID='' ANSWERS_CONFIRMED=yes
write_setup_environment
repository_env_set HTTP_PORT "$port"
mkdir -p "$work/tls" "$work/backups"
if [[ "${SWB_COMPOSE_BUILD_LAYER:-0}" == 1 ]]; then
  "${COMPOSE[@]}" build backend || die 'The backend image build failed.'
fi
build_web_edge || die 'The bundled web edge build failed.'
MSYS_NO_PATHCONV=1 docker run --rm --network none --user "$(id -u):$(id -g)" --entrypoint sh \
  -v "$SWB_TLS_DIR:/tls" -v "$(host_path "$ROOT/deploy/certificates.sh"):/certificates.sh:ro" \
  "$SWB_BACKEND_IMAGE:$SWB_IMAGE_TAG" /certificates.sh

say 'Starting the bundled stack.'
# A cold start on a busy machine is slow; production uses 300 seconds.
"${COMPOSE[@]}" up -d --wait --wait-timeout 600
say 'Migrations ran:'
"${COMPOSE[@]}" logs migrate | grep -E 'migrations|No pending' | tail -n 3
"${COMPOSE[@]}" run --rm ops

say 'The web edge serves the app (/api/health, /api/health/db) and hides the job trigger endpoints.'
edge() { curl --fail --silent --show-error --header 'Host: swbook.localhost' "$@"; }
edge "http://127.0.0.1:$port/api/health" | grep -q '"ok":true' || die '/api/health did not answer ok.'
healthcheck_secret="$(sed -n "s/^HEALTHCHECK_SECRET='\(.*\)'$/\1/p" "$SWB_STATIC_ENV_FILE")"
printf 'header = "Authorization: Bearer %s"\n' "$healthcheck_secret" \
  | edge --config - "http://127.0.0.1:$port/api/health/db" >/dev/null || die '/api/health/db did not answer.'
status="$(curl --silent --output /dev/null --write-out '%{http_code}' --request POST --header 'Host: swbook.localhost' "http://127.0.0.1:$port/api/internal/outbox")"
[[ "$status" == 404 ]] || die "The edge exposed /api/internal/outbox (HTTP $status)."

say 'Waiting for the job worker and beat to report healthy.'
for role in worker beat; do
  health=''
  for _ in $(seq 1 30); do
    health="$(docker inspect --format '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q "$role")")"
    [[ "$health" == healthy ]] && break
    sleep 5
  done
  [[ "$health" == healthy ]] || die "The $role never became healthy."
  "${COMPOSE[@]}" exec -T "$role" node -e \
    "fetch('http://127.0.0.1:3460/health').then(async (r) => { console.log(await r.text()); process.exit(r.ok ? 0 : 1); }, () => process.exit(1))" \
    | grep -q "\"role\":\"$role\"" || die "The $role /health on :3460 did not answer."
  "${COMPOSE[@]}" logs "$role" | tail -n 3
done
# Both processes write a BullMQ heartbeat into Redis; beat also registers the job schedules.
redis_keys() {
  "${COMPOSE[@]}" exec -T redis sh -c \
    "REDISCLI_AUTH=\"\$REDIS_PASSWORD\" redis-cli --tls --cacert /tls/ca.crt -h redis --scan --pattern '$1'"
}
for role in worker beat; do
  [[ -n "$(redis_keys "swb:jobs:heartbeat:$role:*")" ]] || die "No $role heartbeat in Redis."
done
say "Job keys in Redis: $(redis_keys 'swb:jobs:*' | wc -l | tr -d ' ') (heartbeats, schedules and queues)."

say 'Backing up and restoring the database.'
SWB_UPDATE_INSTALL_DIR="$ROOT" bash "$SCRIPT_DIR/backup.sh" --prefix smoke
dump="$(find "$work/backups" -maxdepth 1 -name 'smoke-*.sql.gz' -exec basename {} \; | head -n 1)"
[[ -n "$dump" ]] || die 'No database dump was written.'
SWB_UPDATE_INSTALL_DIR="$ROOT" bash "$SCRIPT_DIR/restore.sh" "backups/$dump" --yes
"${COMPOSE[@]}" run --rm ops
if [[ "${SWB_SMOKE_RECOVERY:-0}" == 1 ]]; then
  CI=true bash "$SCRIPT_DIR/test-vps-recovery.sh"
fi
say 'Bundled stack smoke test passed.'
