#!/usr/bin/env bash
# Backup settings, from the installer menu: how often the backup service dumps the
# database (and mirrors bundled Silo), and how many days scheduled dumps stay in backups/.
# Saved in .env (BACKUP_INTERVAL_HOURS, BACKUP_RETENTION_DAYS); the backup services restart.
#   bash scripts/backup-settings.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SWB_UPDATE_INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# shellcheck source=scripts/install-owner.sh
source "$SCRIPT_DIR/install-owner.sh"
require_install_owner "$SCRIPT_DIR/backup-settings.sh" "$@"
# shellcheck source=scripts/host-lib.sh
source "$SCRIPT_DIR/host-lib.sh"
require_installation
require_tty
backups="${SWB_BACKUP_DIR:-$ROOT/backups}"
restart_backups() {
  local services=(backup)
  [[ "$(repository_env_value SWB_STORAGE)" == external ]] || services+=(backup-storage)
  "${COMPOSE[@]}" up -d "${services[@]}"
}
ask_number() {
  local label="$1" low="$2" high="$3" reply
  printf '%s (%s-%s): ' "$label" "$low" "$high" > /dev/tty
  IFS= read -r reply < /dev/tty || reply=''
  reply="${reply%$'\r'}"
  [[ "$reply" =~ ^[0-9]+$ ]] && ((10#$reply >= low && 10#$reply <= high)) || return 1
  printf '%s' "$((10#$reply))"
}
while true; do
  interval="$(repository_env_value BACKUP_INTERVAL_HOURS)"
  days="$(repository_env_value BACKUP_RETENTION_DAYS)"
  count="$(newest_dumps 100000 | wc -l | tr -d ' ')"
  cat > /dev/tty <<MENU

Backups (in $backups)
  Database dump:     every ${interval:-24} hours, kept ${days:-14} days
  Uploaded files:    $([[ "$(repository_env_value SWB_STORAGE)" == external ]] && echo 'in your external bucket (use its versioning)' || echo "mirrored every ${interval:-24} hours")
  Dumps here now:    $count; newest $(newest_dumps 1 || true)
  Backups hold every secret. Copy them off this server, encrypted, on a schedule of your own.

  1) Change how often backups run
  2) Change how many days scheduled dumps are kept
  3) Back up now
  0) Done
MENU
  case "$(menu_choice 3)" in
    1) value="$(ask_number 'Hours between backups' 1 168)" || { warn 'Enter a whole number of hours.'; continue; }
       repository_env_set BACKUP_INTERVAL_HOURS "$value"; restart_backups; say "Backups run every $value hours." ;;
    2) value="$(ask_number 'Days to keep scheduled dumps' 1 3650)" || { warn 'Enter a whole number of days.'; continue; }
       repository_env_set BACKUP_RETENTION_DAYS "$value"; restart_backups; say "Scheduled dumps are kept $value days." ;;
    3) bash "$SCRIPT_DIR/backup.sh" ;;
    0) exit 0 ;;
    *) warn 'Choose one of the listed numbers.' ;;
  esac
done
