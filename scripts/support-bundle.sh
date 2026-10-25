#!/usr/bin/env bash
# Collect a support bundle for troubleshooting, from the installer menu: versions, the
# settings without secrets, service state, the operator checks, disk and memory, and the
# last 500 log lines of each service, with credentials, tokens and keys redacted. Logs can
# still hold email and IP addresses: read the bundle before sharing it.
#   bash scripts/support-bundle.sh          writes support/swbook-support-<UTC>.tar.gz
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SWB_UPDATE_INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# shellcheck source=scripts/install-owner.sh
source "$SCRIPT_DIR/install-owner.sh"
require_install_owner "$SCRIPT_DIR/support-bundle.sh" "$@"
# shellcheck source=scripts/host-lib.sh
source "$SCRIPT_DIR/host-lib.sh"
require_installation
umask 077
name="swbook-support-$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
out="$work/$name"
mkdir -p "$out/logs"
# Settings whose values are safe to share; every other key is reported only as set.
SHAREABLE='SWB_REPOSITORY|SWB_BACKEND_IMAGE|SWB_FRONTEND_IMAGE|SWB_LAYER|SWB_STORAGE|PUBLIC_APP_BASE_URL|SITE_ADDRESS|HTTP_PORT|ALLOW_PLAIN_HTTP|DEPLOYMENT_MODE|SMTP_HOST|SMTP_PORT|SMTP_SECURE|S3_ENDPOINT|S3_REGION|S3_BUCKET|BACKUP_INTERVAL_HOURS|BACKUP_RETENTION_DAYS|PWNED_PASSWORDS_CHECK|JOBS_QUEUE_PREFIX|QUEUE_OUTBOX_CONCURRENCY|QUEUE_SCHEDULED_CONCURRENCY'

redact() {
  sed -E \
    -e 's#(Bearer )[A-Za-z0-9._~+/=-]+#\1REDACTED#g' \
    -e 's#(://)[^/@[:space:]]+@#\1REDACTED@#g' \
    -e 's#((password|passwd|secret|token|key|authorization|cookie)[^=:[:space:]]*[=:][[:space:]]*)[^[:space:],"&]+#\1REDACTED#Ig' \
    -e 's#((password|passwd|secret|token|key|authorization|cookie)[^"]*"[[:space:]]*:[[:space:]]*")[^"]*#\1REDACTED#Ig' \
    -e 's#(/(invite|reset-password|magic-link|verify-email)/|[?&](token|code)=)[A-Za-z0-9_.-]+#\1REDACTED#g' \
    -e 's#[A-Za-z0-9+/]{43}=|[a-f0-9]{64,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}#REDACTED#g'
}
section() { printf '\n== %s\n' "$1"; }
settings() {
  local file="${SWB_STATIC_ENV_FILE:-$ROOT/.env}"
  grep -E "^($SHAREABLE)=" "$file" || true
  grep -E '^[A-Z][A-Z0-9_]*=' "$file" | grep -vE "^($SHAREABLE)=" | sed -E 's/=.*/ is set/'
}

say 'Collecting the support bundle.'
{
  section 'Release'
  cat "$ROOT/.spaceworks-version" 2>/dev/null || echo 'no version marker'
  cat "$ROOT/.spaceworks-source-ref" 2>/dev/null || true
  section 'Settings (.env, secrets reduced to "is set")'; settings
  section 'Newest backups'; newest_dumps 5
  section 'System'; cat /etc/os-release 2>/dev/null || sw_vers 2>/dev/null || true; uname -a; uptime
  section 'Memory'; free -m 2>/dev/null || vm_stat 2>/dev/null || true
  section 'Disk'; df -h "$ROOT" 2>/dev/null || df -h
  section 'Docker'; docker version 2>&1; docker compose version 2>&1
  section 'Services'; "${COMPOSE[@]}" ps -a 2>&1
  section 'Checks'; "${COMPOSE[@]}" run --rm ops 2>&1 || true
} 2>&1 | redact > "$out/report.txt"
for service in backend worker beat migrate caddy db redis minio createbuckets backup backup-storage; do
  "${COMPOSE[@]}" logs --no-color --tail 500 "$service" 2>&1 | redact > "$out/logs/$service.log" || true
  [[ -s "$out/logs/$service.log" ]] || rm -f "$out/logs/$service.log"
done
mkdir -p "$ROOT/support"
chmod 700 "$ROOT/support"
tar -czf "$ROOT/support/$name.tar.gz" -C "$work" "$name"
say "Support bundle: $ROOT/support/$name.tar.gz"
say 'Credentials, tokens and keys are redacted, but logs can hold email and IP addresses. Read it before sharing.'
