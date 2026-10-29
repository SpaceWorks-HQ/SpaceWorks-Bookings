#!/usr/bin/env bash
# Restore the database from a dump in backups/ (and, with --with-storage, the files
# from backups/storage). This replaces live data: the backend, job worker and beat and web
# edge stop until it finishes, and a fresh database backup is taken first.
#   bash scripts/restore.sh backups/<name>.sql.gz [--with-storage] [--yes]
#   bash scripts/restore.sh            choose from the newest dumps (installer menu)
# Migrations then bring an older dump up to the running release.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SWB_UPDATE_INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# shellcheck source=scripts/install-owner.sh
source "$SCRIPT_DIR/install-owner.sh"
require_install_owner "$SCRIPT_DIR/restore.sh" "$@"
# shellcheck source=scripts/spaceworks-repository.sh
source "$SCRIPT_DIR/spaceworks-repository.sh"
say() { printf '[Space Works restore] %s\n' "$*"; }
warn() { printf '[Space Works restore] WARNING: %s\n' "$*" >&2; }
die() { printf '[Space Works restore] ERROR: %s\n' "$*" >&2; exit 1; }
COMPOSE=("$SCRIPT_DIR/spaceworks-compose.sh" bundled)
dump='' with_storage=0 assume_yes=0
for argument in "$@"; do
  case "$argument" in
    --with-storage) with_storage=1 ;;
    --yes) assume_yes=1 ;;
    -*) die 'Usage: bash scripts/restore.sh backups/<name>.sql.gz [--with-storage] [--yes]' ;;
    *) dump="$argument" ;;
  esac
done
backups="${SWB_BACKUP_DIR:-$ROOT/backups}"
if [[ -z "$dump" && "$assume_yes" == 0 && -r /dev/tty ]]; then
  # shellcheck source=scripts/host-lib.sh
  source "$SCRIPT_DIR/host-lib.sh"
  mapfile -t dumps < <(newest_dumps 10)
  ((${#dumps[@]} > 0)) || die "There are no database dumps in $backups yet."
  printf '\nDatabase dumps in %s, newest first:\n' "$backups" > /dev/tty
  for index in "${!dumps[@]}"; do printf '  %s) %s\n' "$((index + 1))" "${dumps[$index]}" > /dev/tty; done
  printf '  0) Cancel\n' > /dev/tty
  choice="$(menu_choice "${#dumps[@]}")"
  [[ "$choice" != 0 ]] || { say 'Cancelled. Nothing was changed.'; exit 2; }
  [[ "$choice" != invalid ]] || die 'Invalid choice. Nothing was changed.'
  dump="${dumps[$((choice - 1))]}"
  if [[ "$(repository_env_value SWB_STORAGE)" != external && -d "$backups/storage" ]] \
    && confirm 'Also restore the uploaded files from backups/storage?' N; then
    with_storage=1
  fi
fi
name="$(basename "${dump:-}")"
[[ "$name" =~ ^[a-z][a-z0-9-]*-[0-9]{8}T[0-9]{6}Z\.sql\.gz$ && -s "$backups/$name" ]] \
  || die "Choose a dump made by scripts/backup.sh or the backup service, inside $backups."
[[ "$with_storage" == 0 || "$(repository_env_value SWB_STORAGE)" != external ]] \
  || die 'Files in an external bucket are restored with your storage provider.'
if [[ "$assume_yes" == 0 ]]; then
  [[ -r /dev/tty ]] || die 'An interactive terminal is required (or pass --yes).'
  printf '\nRestore %s%s\nThe site is offline during the restore. A backup of the current database is taken first.\n' \
    "$name" "$([[ "$with_storage" == 1 ]] && echo ' and backups/storage' || true)" >/dev/tty
  printf 'Type RESTORE to continue: ' >/dev/tty
  IFS= read -r answer </dev/tty || answer=''
  [[ "${answer%$'\r'}" == RESTORE ]] || { say 'Cancelled. Nothing was changed.'; exit 2; }
fi
stopped=0
database_committed=0
serving_services
backup_services=(backup)
[[ "$(repository_env_value SWB_STORAGE)" == external ]] || backup_services+=(backup-storage)
restore_services=("${SERVING_SERVICES[@]}" "${backup_services[@]}")
restart_on_failure() {
  local status=$?
  trap - EXIT
  [[ $status != 0 && $stopped == 1 ]] || return 0
  if [[ $database_committed == 0 ]]; then
    warn 'The database restore failed before commit; starting the services again.'
    "${COMPOSE[@]}" up -d --wait --wait-timeout 300 --no-deps "${SERVING_SERVICES[@]}" >/dev/null 2>&1 \
      || warn 'Start the serving services after checking the restore failure.'
    warn 'Backup schedules remain paused to preserve the recovery source until a successful restore.'
  else
    warn 'The database was restored, but files or startup checks failed. Keeping the site offline; fix the failure and retry the restore.'
    # Compose up may already have started some services before migration or
    # readiness failed. Stop them again rather than serving a partial restore.
    "${COMPOSE[@]}" stop "${restore_services[@]}" >/dev/null 2>&1 \
      || warn 'Some services could not be stopped. Stop them before retrying the restore.'
  fi
  exit "$status"
}
trap restart_on_failure EXIT
stopped=1
"${COMPOSE[@]}" stop "${restore_services[@]}"
# Freeze the mirror source before taking the safety dump, including on retries.
bash "$SCRIPT_DIR/backup.sh" --prefix pre-restore --no-storage
data_services=(db redis)
[[ "$(repository_env_value SWB_STORAGE)" == external ]] || data_services+=(minio)
"${COMPOSE[@]}" up -d --wait --wait-timeout 300 "${data_services[@]}"
if [[ "$(repository_env_value SWB_STORAGE)" != external ]]; then
  "${COMPOSE[@]}" run --rm --no-deps -T createbuckets
fi
"${COMPOSE[@]}" run --rm --no-deps -T backup restore "$name"
database_committed=1
if [[ "$with_storage" == 1 ]]; then
  "${COMPOSE[@]}" run --rm --no-deps -T backup-storage restore-storage
fi
# An existing completed migration container must not substitute for applying
# this release's migrations to the newly restored, potentially older database.
"${COMPOSE[@]}" run --rm --no-deps -T migrate
"${COMPOSE[@]}" up -d --wait --wait-timeout 300 --no-deps "${SERVING_SERVICES[@]}"
"${COMPOSE[@]}" run --rm --no-deps -T ops
# A storage scheduler mirrors with --remove: never start it against an empty
# recovery bucket or before the complete database/files/app checks succeed.
"${COMPOSE[@]}" up -d --wait --wait-timeout 300 --no-deps "${backup_services[@]}"
stopped=0
say 'Restore finished. Sign in and check recent payments and uploads.'
