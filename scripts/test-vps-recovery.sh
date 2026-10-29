#!/usr/bin/env bash
# Real encrypted recovery of the disposable bundled acceptance stack, never an operator's installation.
set -euo pipefail
set +x
[[ "${CI:-}" == true ]] || { echo 'Recovery acceptance requires an isolated CI runner.' >&2; exit 1; }
: "${SWB_COMPOSE_PROJECT:?Disposable project required}"
case "$SWB_COMPOSE_PROJECT" in swbook-smoke*|sw-audit-bookings-*) ;; *) echo 'Refusing a non-smoke project.' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
original_env="${SWB_STATIC_ENV_FILE:-$root/.env}"
original_tls="${SWB_TLS_DIR:-$root/tls}"
original_backups="${SWB_BACKUP_DIR:-$root/backups}"
original_project="$SWB_COMPOSE_PROJECT"
if ! command -v age >/dev/null || ! command -v age-keygen >/dev/null; then
  echo 'Install age for encrypted recovery acceptance.' >&2
  exit 1
fi
work="$(mktemp -d)"
umask 077
as_root() { if [[ "$(id -u)" == 0 ]]; then "$@"; else sudo -n -- "$@"; fi; }
cleanup() {
  local status=$?
  if [[ "$SWB_COMPOSE_PROJECT" != "$original_project" ]]; then
    if [[ "$status" != 0 ]]; then
      # Redis startup diagnostics contain no credentials; retain TLS failure
      # evidence before removing this disposable recovery project.
      scripts/spaceworks-compose.sh bundled logs --no-color --tail 30 redis >&2 || true
    fi
    scripts/spaceworks-compose.sh bundled down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  as_root rm -rf -- "$work"
  exit "$status"
}
trap cleanup EXIT
COMPOSE=("$root/scripts/spaceworks-compose.sh" bundled)
"${COMPOSE[@]}" run --rm --no-deps -T -e SWB_RECOVERY_SMOKE=1 ops --role ops node dist/recovery-smoke.js seed
bash scripts/backup.sh
dump="$(as_root find "$original_backups" -maxdepth 1 -name 'manual-*.sql.gz' | sort | tail -n 1)"
config="$(as_root find "$original_backups" -maxdepth 1 -name 'config-*.tar.gz' | sort | tail -n 1)"
as_root test -s "$dump"
as_root test -s "$config"
as_root test -d "$original_backups/storage"
age-keygen -o "$work/identity" 2>/dev/null
recipient="$(age-keygen -y "$work/identity")"
mkdir -m 700 "$work/off-host"
as_root tar -cf - -C "$original_backups" "$(basename "$dump")" "$(basename "$config")" storage \
  | age --recipient "$recipient" -o "$work/off-host/backup.tar.age"
test -s "$work/off-host/backup.tar.age"
echo 'Database, object mirror and private configuration copied into an age-encrypted off-host bundle.'
# Destroy source data; a different project creates genuinely empty PostgreSQL and Silo volumes.
"${COMPOSE[@]}" down --volumes --remove-orphans
export SWB_COMPOSE_PROJECT="${original_project}-recovered"
recovered="$work/recovered"
mkdir -m 700 "$recovered" "$recovered/backups"
age --decrypt --identity "$work/identity" "$work/off-host/backup.tar.age" | as_root tar -xf - -C "$recovered/backups"
as_root tar -xzf "$recovered/backups/$(basename "$config")" -C "$recovered"
as_root cmp "$original_env" "$recovered/.env"
as_root diff -qr "$original_tls" "$recovered/tls"
export SWB_STATIC_ENV_FILE="$recovered/.env" SWB_TLS_DIR="$recovered/tls" SWB_BACKUP_DIR="$recovered/backups"
# Keep serving and backup schedulers off. In particular, backup-storage uses
# --remove and would erase the recovered mirror if it saw the empty new bucket.
"${COMPOSE[@]}" up -d --wait --wait-timeout 600 db redis minio
"${COMPOSE[@]}" run --rm --no-deps -T createbuckets
"${COMPOSE[@]}" run --rm --no-deps -T migrate
if [[ "${SWB_SMOKE_MAILPIT:-0}" == 1 ]]; then
  # Optional acceptance-only SMTP fixture belongs to the newly created project.
  "${COMPOSE[@]}" up -d --wait --wait-timeout 300 audit-mailpit
fi
"${COMPOSE[@]}" run --rm --no-deps -T -e SWB_RECOVERY_SMOKE=1 ops --role ops node dist/recovery-smoke.js empty
"${COMPOSE[@]}" exec -T db psql --no-password -U swbook -d swbook -v ON_ERROR_STOP=1 \
  -c 'CREATE TABLE public."RecoveryTargetResidue" (id integer PRIMARY KEY);'
bash scripts/restore.sh "backups/$(basename "$dump")" --with-storage --yes
test "$("${COMPOSE[@]}" exec -T db psql --no-password -U swbook -d swbook -Atqc \
  "SELECT to_regclass('public.\"RecoveryTargetResidue\"') IS NULL")" = t
"${COMPOSE[@]}" run --rm --no-deps -T -e SWB_RECOVERY_SMOKE=1 ops --role ops node dist/recovery-smoke.js verify
if [[ "${SWB_SMOKE_MAILPIT:-0}" == 1 ]]; then
  "${COMPOSE[@]}" run --rm --no-deps -T -e SWB_RECOVERY_SMOKE=1 ops --role ops node dist/recovery-smoke.js mail
fi
"${COMPOSE[@]}" run --rm --no-deps -T ops
echo 'Encrypted recovery onto empty database/storage volumes with recovered configuration and usable keys passed.'
