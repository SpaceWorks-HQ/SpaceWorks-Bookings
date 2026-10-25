#!/usr/bin/env bash
# Recover super-admin access from the server, from the installer menu: remove a lost
# authenticator, set a new password, or create another super admin. Super-admin
# passwords are only ever set here (docker/ops/admin.mjs through scripts/admin.sh),
# never by email or in the app.
#   bash scripts/recover-admin.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SWB_UPDATE_INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
# shellcheck source=scripts/install-owner.sh
source "$SCRIPT_DIR/install-owner.sh"
require_install_owner "$SCRIPT_DIR/recover-admin.sh" "$@"
# shellcheck source=scripts/host-lib.sh
source "$SCRIPT_DIR/host-lib.sh"
require_installation
require_tty
admin() { bash "$SCRIPT_DIR/admin.sh" "$@" < /dev/tty; }
default_email="$(repository_env_value SUPER_ADMIN_EMAIL)"
printf 'Super-admin email [%s]: ' "${default_email:-required}" > /dev/tty
IFS= read -r email < /dev/tty || email=''
email="${email%$'\r'}"
email="${email:-$default_email}"
[[ "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die 'Enter an email address.'
cat > /dev/tty <<MENU

Recover access for $email
  1) Lost authenticator - remove its two-step sign-in; it sets up a new one at the next sign-in
  2) Lost password - set a new password here
  3) Both - remove the authenticator and set a new password
  4) Create a new super admin with this email
  5) List the super admins
  0) Cancel
MENU
case "$(menu_choice 5)" in
  1) admin reset-mfa --email "$email" ;;
  2) admin set-password --email "$email" ;;
  3) admin reset-mfa --email "$email" && admin set-password --email "$email" ;;
  4) admin create --email "$email" ;;
  5) admin list ;;
  0) say 'Cancelled. Nothing was changed.' ;;
  *) die 'Invalid choice. Nothing was changed.' ;;
esac
