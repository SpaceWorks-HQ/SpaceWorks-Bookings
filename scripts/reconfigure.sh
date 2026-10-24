#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2154 # question() assigns the answers by name
# Change settings, from the installer menu: the web address, outgoing email, or the keys of
# an external bucket. The answers are written to .env, then the stack is recreated with
# them and the operator checks run. Secrets are never printed.
#   bash scripts/reconfigure.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SWB_UPDATE_INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# shellcheck source=scripts/install-owner.sh
source "$SCRIPT_DIR/install-owner.sh"
require_install_owner "$SCRIPT_DIR/reconfigure.sh" "$@"
# shellcheck source=scripts/host-lib.sh
source "$SCRIPT_DIR/host-lib.sh"
# shellcheck source=scripts/setup-question-input.sh
source "$SCRIPT_DIR/setup-question-input.sh"
require_installation
require_tty
SWB_NONINTERACTIVE=0
exec 3</dev/tty
changed=0
set_value() { repository_env_set "$1" "$2" || die "Could not save $1."; changed=1; }

change_address() {
  local layer mode
  layer="$(repository_env_value SWB_LAYER)"
  mode="$(repository_env_value DEPLOYMENT_MODE)"
  say "Now: website $(repository_env_value PUBLIC_APP_BASE_URL), this server $(repository_env_value SITE_ADDRESS)."
  if [[ "$mode" == backend ]]; then
    question SITE_ORIGIN 'Website URL on Netlify (HTTPS origin)' '' origin || return 1
    question PUBLIC_DOMAIN 'Domain of this backend server' '' domain || return 1
    set_value PUBLIC_APP_BASE_URL "$SITE_ORIGIN"
    set_value SITE_ADDRESS "$([[ "$layer" == tls ]] && echo "$PUBLIC_DOMAIN" || echo "http://$PUBLIC_DOMAIN")"
  elif [[ "$layer" == none ]]; then
    question WEBHOST 'Web address (host name or IP, no http://)' '' host || return 1
    set_value PUBLIC_APP_BASE_URL "http://$WEBHOST"
    set_value SITE_ADDRESS "http://$WEBHOST"
  else
    question PUBLIC_DOMAIN 'Public domain (DNS points at this server)' '' domain || return 1
    set_value PUBLIC_APP_BASE_URL "https://$PUBLIC_DOMAIN"
    set_value SITE_ADDRESS "$([[ "$layer" == tls ]] && echo "$PUBLIC_DOMAIN" || echo "http://$PUBLIC_DOMAIN")"
    [[ "$layer" != tls ]] || say "Point $PUBLIC_DOMAIN at this server; Caddy fetches its certificate on the next start."
    [[ "$layer" != proxy ]] || say "Forward https://$PUBLIC_DOMAIN in your proxy to 127.0.0.1:8080."
  fi
  say 'Sign-in links and emails use the new address after the restart. Existing sessions sign out.'
}

change_email() {
  question EMAIL_FROM 'Sender, as Name <address@your-domain>' "$(repository_env_value EMAIL_FROM)" sender || return 1
  question SMTP_HOST 'SMTP host' "$(repository_env_value SMTP_HOST)" domain || return 1
  question SMTP_PORT 'SMTP port (implicit TLS: 465)' "$(repository_env_value SMTP_PORT)" port || return 1
  question SMTP_USER 'SMTP login' "$(repository_env_value SMTP_USER)" text || return 1
  question SMTP_PASSWORD 'SMTP password or key (Enter keeps the current one)' '' optional || return 1
  set_value EMAIL_FROM "$EMAIL_FROM"
  set_value SMTP_HOST "$SMTP_HOST"
  set_value SMTP_PORT "$SMTP_PORT"
  set_value SMTP_SECURE "$([[ "$SMTP_PORT" == 465 ]] && echo true || echo false)"
  set_value SMTP_USER "$SMTP_USER"
  [[ -z "$SMTP_PASSWORD" ]] || set_value SMTP_PASSWORD "$SMTP_PASSWORD"
}

change_bucket() {
  [[ "$(repository_env_value SWB_STORAGE)" == external ]] \
    || { warn 'Files are in the bundled Silo storage; its keys are generated and managed here.'; return 0; }
  question S3_ENDPOINT 'S3 endpoint' "$(repository_env_value S3_ENDPOINT)" secure_url || return 1
  question S3_REGION 'S3 region (R2: auto)' "$(repository_env_value S3_REGION)" region || return 1
  question S3_BUCKET 'Private bucket' "$(repository_env_value S3_BUCKET)" bucket || return 1
  question S3_ACCESS_KEY 'S3 access key' "$(repository_env_value S3_ACCESS_KEY_ID)" text || return 1
  question S3_SECRET_KEY 'S3 secret key (Enter keeps the current one)' '' optional || return 1
  set_value S3_ENDPOINT "$S3_ENDPOINT"
  set_value S3_REGION "$S3_REGION"
  set_value S3_BUCKET "$S3_BUCKET"
  set_value S3_ACCESS_KEY_ID "$S3_ACCESS_KEY"
  [[ -z "$S3_SECRET_KEY" ]] || set_value S3_SECRET_ACCESS_KEY "$S3_SECRET_KEY"
}

while true; do
  cat > /dev/tty <<'MENU'

Change settings
  1) Web address - the domain or host name people open
  2) Outgoing email - sender and SMTP relay
  3) External bucket - endpoint, bucket and keys (external storage only)
  0) Done - apply the changes and restart
MENU
  case "$(menu_choice 3)" in
    1) change_address || warn 'Nothing was changed.' ;;
    2) change_email || warn 'Nothing was changed.' ;;
    3) change_bucket || warn 'Nothing was changed.' ;;
    0) break ;;
    *) warn 'Choose one of the listed numbers.' ;;
  esac
done
exec 3<&-
[[ "$changed" == 1 ]] || { say 'Nothing was changed.'; exit 0; }
say 'Restarting with the new settings.'
"${COMPOSE[@]}" up -d --wait --wait-timeout 300 || die "The stack did not become healthy. Inspect with: ${COMPOSE[*]} ps"
"${COMPOSE[@]}" run --rm ops || die 'Operator checks failed; run bash scripts/status.sh.'
say 'Settings applied.'
