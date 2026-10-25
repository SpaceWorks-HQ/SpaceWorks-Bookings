#!/usr/bin/env bash
# Shared by the maintenance scripts the installer menu runs (status, backup settings,
# change settings, server security, recovery, support bundle, uninstall). Source it after
# setting SCRIPT_DIR and ROOT; it brings the repository helpers and the Compose wrapper.
# shellcheck source=scripts/spaceworks-repository.sh
source "$SCRIPT_DIR/spaceworks-repository.sh"
# shellcheck disable=SC2034 # used by the scripts that source this file
COMPOSE=("$SCRIPT_DIR/spaceworks-compose.sh" bundled)
say()  { printf '[Space Works] %s\n' "$*"; }
warn() { printf '[Space Works] WARNING: %s\n' "$*" >&2; }
die()  { printf '[Space Works] ERROR: %s\n' "$*" >&2; exit 1; }
require_tty() { [[ -r /dev/tty && -w /dev/tty ]] || die 'This needs an interactive terminal.'; }
require_installation() {
  [[ -f "${SWB_STATIC_ENV_FILE:-$ROOT/.env}" ]] || die "No installation settings in $ROOT/.env; run the installer first."
}
# confirm QUESTION Y|N: true for yes; Enter takes the default.
confirm() {
  local reply hint=y/N
  [[ "$2" != Y ]] || hint=Y/n
  printf '%s [%s]: ' "$1" "$hint" > /dev/tty
  IFS= read -r reply < /dev/tty || reply=''
  reply="${reply%$'\r'}"
  [[ "${reply:-$2}" =~ ^[Yy] ]]
}
# menu_choice LAST: read a number from 0 to LAST (Enter = 0).
menu_choice() {
  local reply
  printf 'Choose 0-%s [0]: ' "$1" > /dev/tty
  IFS= read -r reply < /dev/tty || reply=''
  reply="${reply%$'\r'}"
  reply="${reply:-0}"
  [[ "$reply" =~ ^[0-9]+$ ]] && ((10#$reply <= $1)) || reply=invalid
  printf '%s' "$reply"
}
# The newest database dumps in backups/, newest first.
newest_dumps() {
  local backups="${SWB_BACKUP_DIR:-$ROOT/backups}"
  [[ -d "$backups" ]] || return 0
  find "$backups" -maxdepth 1 -type f -name '*-[0-9]*T[0-9]*Z.sql.gz' -print \
    | sed 's#.*/##' | awk -F- '{ print $NF "\t" $0 }' | sort -r | cut -f2 | head -n "${1:-10}"
}
