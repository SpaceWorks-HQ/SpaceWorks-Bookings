#!/usr/bin/env bash
# Remove Space Works Bookings from this server, from the installer menu: the containers,
# the GitHub Actions runner, the images and the install directory. Unless DELETE DATA is
# typed, the data (database and uploads in Docker volumes) and the settings, certificates
# and backups (.env, tls/, backups/) stay, moved to <install dir>.uninstalled-<UTC>.
# Docker itself and any server hardening stay.
#   bash scripts/uninstall.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SWB_UPDATE_INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# shellcheck source=scripts/install-owner.sh
source "$SCRIPT_DIR/install-owner.sh"
require_install_owner "$SCRIPT_DIR/uninstall.sh" "$@"
# shellcheck source=scripts/host-lib.sh
source "$SCRIPT_DIR/host-lib.sh"
require_installation
require_tty
[[ "$ROOT" == /?* && "$ROOT" != / && -f "$ROOT/.spaceworks-version" ]] || die "$ROOT is not an installation directory."
ask_text() { local reply; printf '%s: ' "$1" > /dev/tty; IFS= read -r reply < /dev/tty || reply=''; printf '%s' "${reply%$'\r'}"; }
cat > /dev/tty <<MSG

Uninstall Space Works Bookings ($(repository_env_value PUBLIC_APP_BASE_URL))
  Removed: the containers, the GitHub Actions runner, the images and $ROOT
  Kept unless you choose otherwise next: the database and uploads (Docker volumes) and
  .env, tls/ and backups/ (every secret), moved to $ROOT.uninstalled-<time>
MSG
[[ "$(ask_text 'Type UNINSTALL to continue')" == UNINSTALL ]] || { say 'Cancelled. Nothing was changed.'; exit 2; }
cat > /dev/tty <<'MSG'

Also delete all data? This permanently erases the database, the uploads in the bundled
storage, the settings with every secret and every backup in backups/.
Copy any backup you need off this server first.
MSG
delete_data=0
[[ "$(ask_text 'Type DELETE DATA to erase it, or press Enter to keep it')" != 'DELETE DATA' ]] || delete_data=1
if [[ -f "$SCRIPT_DIR/install-runner.sh" ]] && [[ -d "${SWB_RUNNER_DIR:-/opt/spaceworks-bookings-runner}" ]]; then
  bash "$SCRIPT_DIR/install-runner.sh" --remove < /dev/tty \
    || warn 'Remove the runner in GitHub (Settings -> Actions -> Runners) by hand.'
fi
images="$("${COMPOSE[@]}" config --images 2>/dev/null | grep -E 'spaceworks-bookings-(backend|frontend)' | sort -u || true)"
if [[ "$delete_data" == 1 ]]; then
  "${COMPOSE[@]}" down --volumes --remove-orphans
else
  "${COMPOSE[@]}" down --remove-orphans
fi
# shellcheck disable=SC2086 # one image name per word
[[ -z "$images" ]] || docker image rm $images >/dev/null 2>&1 || true
if [[ "$delete_data" == 1 ]]; then
  # Backups and certificates written by containers may belong to root.
  docker run --rm -v "$ROOT:/install" alpine:3 sh -c 'rm -rf /install/backups /install/tls' >/dev/null 2>&1 || true
  rm -rf -- "$ROOT"
  say 'Space Works Bookings and all of its data are removed.'
else
  kept="$ROOT.uninstalled-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -m 700 -- "$kept"
  for item in .env tls backups .spaceworks-version; do
    [[ ! -e "$ROOT/$item" ]] || mv -- "$ROOT/$item" "$kept/"
  done
  rm -rf -- "$ROOT"
  say "Space Works Bookings is uninstalled. The data volumes (swbook_*) were kept, and"
  say "$kept holds .env, tls/ and backups/ (every secret): copy it off this server, encrypted."
  say 'To reinstall with this data, follow "Restore on a new server" in docs/DEPLOYMENT_VPS.md.'
fi
