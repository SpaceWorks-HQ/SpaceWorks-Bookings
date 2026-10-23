#!/usr/bin/env bash
# Show the installation's release, address, services, the job worker and beat, disk and the
# newest backup, then run the operator checks (database TLS, migrations, Redis, bucket, app,
# worker and beat health). Changes nothing; exits non-zero when a check fails.
#   bash scripts/status.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SWB_UPDATE_INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# shellcheck source=scripts/install-owner.sh
source "$SCRIPT_DIR/install-owner.sh"
require_install_owner "$SCRIPT_DIR/status.sh" "$@"
# shellcheck source=scripts/host-lib.sh
source "$SCRIPT_DIR/host-lib.sh"
require_installation
version="$(tr -d '[:space:]' < "$ROOT/.spaceworks-version" 2>/dev/null || echo unknown)"
ref="$(tr -d '[:space:]' < "$ROOT/.spaceworks-source-ref" 2>/dev/null || true)"
say "Release: $version${ref:+ (built here from $ref)} from $(repository_env_value SWB_REPOSITORY)"
say "Web address: $(repository_env_value PUBLIC_APP_BASE_URL)"
say "HTTPS layer: $(repository_env_value SWB_LAYER); storage: $(repository_env_value SWB_STORAGE)"
say "Free disk: $(df -Pk "$ROOT" | awk 'NR == 2 { print int($4 / 1024) }') MB"
newest="$(newest_dumps 1)"
say "Newest database backup: ${newest:-none yet; run bash scripts/backup.sh}"
"${COMPOSE[@]}" ps
# The worker and beat report a BullMQ heartbeat on :3460; Docker's health check reads it.
for service in backend worker beat; do
  container="$("${COMPOSE[@]}" ps -q "$service" 2>/dev/null || true)"
  if [[ -z "$container" ]]; then
    warn "$service is not running."
    continue
  fi
  say "$service: $(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")"
done
"${COMPOSE[@]}" run --rm ops
