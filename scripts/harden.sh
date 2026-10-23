#!/usr/bin/env bash
# Optional host hardening, from the installer menu (Server security):
#   firewall          ufw (Debian/Ubuntu) or firewalld: only SSH, HTTP and HTTPS in
#   security updates  unattended-upgrades or dnf-automatic, security fixes only
#   fail2ban          bans addresses that keep failing SSH logins
# Each step is asked for unless --all is given. SSH stays open on every port sshd listens
# on; if those ports cannot be found the firewall is left alone. Docker publishes its own
# ports past ufw; this stack publishes only 80 and 443 (or 127.0.0.1:8080 behind a proxy).
#   bash scripts/harden.sh [--all]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say()  { printf '[Space Works] %s\n' "$*"; }
warn() { printf '[Space Works] WARNING: %s\n' "$*" >&2; }
die()  { printf '[Space Works] ERROR: %s\n' "$*" >&2; exit 1; }
all=0
case "${1:-}" in
  '') [[ -r /dev/tty ]] || die 'This needs an interactive terminal (or pass --all).' ;;
  --all) all=1 ;;
  *) die 'Usage: bash scripts/harden.sh [--all]' ;;
esac
[[ "$(uname -s)" == Linux ]] || die 'Server security settings apply to a Linux server only.'
if [[ "$(id -u)" != 0 ]]; then
  command -v sudo >/dev/null 2>&1 || die 'Run this as root.'
  exec sudo bash "$SCRIPT_DIR/harden.sh" "$@"
fi
# shellcheck disable=SC1091
family="$(. /etc/os-release; case " ${ID:-} ${ID_LIKE:-} " in
  *" debian "*|*" ubuntu "*) echo debian ;;
  *" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*) echo rhel ;;
  *) echo other ;; esac)"
install_packages() {
  case "$family" in
    debian) DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    rhel) if command -v dnf >/dev/null 2>&1; then dnf install -y "$@"; else yum install -y "$@"; fi ;;
    *) return 1 ;;
  esac
}
want() {
  local reply
  [[ "$all" == 0 ]] || return 0
  printf '%s [Y/n]: ' "$1" > /dev/tty
  IFS= read -r reply < /dev/tty || reply=''
  [[ "${reply:-Y}" =~ ^[Yy] ]]
}
ssh_ports() {
  { ss -Htlnp 2>/dev/null | awk '/"sshd"/ { n = split($4, part, ":"); print part[n] }'
    sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }'; } | grep -E '^[0-9]+$' | sort -un
}

if want 'Turn on a firewall that allows only SSH, HTTP and HTTPS?'; then
  mapfile -t ports < <(ssh_ports)
  if [[ ${#ports[@]} == 0 ]]; then
    warn 'Could not find the SSH port, so the firewall was left alone to keep you from being locked out.'
  elif systemctl is-active --quiet firewalld 2>/dev/null; then
    for port in "${ports[@]}"; do firewall-cmd --quiet --permanent --add-port="$port/tcp"; done
    firewall-cmd --quiet --permanent --add-service=http --add-service=https --add-port=443/udp
    firewall-cmd --quiet --reload
    say "firewalld allows SSH (port ${ports[*]}), HTTP and HTTPS."
  elif [[ "$family" == debian ]]; then
    command -v ufw >/dev/null 2>&1 || install_packages ufw >/dev/null
    for port in "${ports[@]}"; do ufw allow "$port/tcp" >/dev/null; done
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw allow 443/udp >/dev/null
    ufw --force enable >/dev/null
    say "ufw allows SSH (port ${ports[*]}), HTTP and HTTPS."
  else
    warn 'No supported firewall here (ufw or firewalld); configure one with your provider.'
  fi
fi

if want 'Install security updates automatically?'; then
  case "$family" in
    debian)
      install_packages unattended-upgrades >/dev/null
      cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
      say 'Security updates install automatically (unattended-upgrades).' ;;
    rhel)
      install_packages dnf-automatic >/dev/null
      sed -i -e 's/^upgrade_type *=.*/upgrade_type = security/' -e 's/^apply_updates *=.*/apply_updates = yes/' /etc/dnf/automatic.conf
      systemctl enable --now dnf-automatic.timer >/dev/null 2>&1
      say 'Security updates install automatically (dnf-automatic).' ;;
    *) warn 'Automatic updates are not set up on this distribution; use its own tool.' ;;
  esac
fi

if want 'Ban addresses that keep failing SSH logins (fail2ban)?'; then
  if (install_packages fail2ban) >/dev/null 2>&1; then
    backend=auto
    [[ -f /var/log/auth.log || -f /var/log/secure ]] || backend=systemd
    cat > /etc/fail2ban/jail.d/spaceworks-bookings.local <<CONF
[sshd]
enabled = true
backend = $backend
maxretry = 5
bantime = 1h
CONF
    systemctl enable fail2ban >/dev/null 2>&1 || true
    if systemctl restart fail2ban; then
      say 'fail2ban bans an address for an hour after five failed SSH logins.'
    else
      warn 'fail2ban did not start; see journalctl -u fail2ban.'
    fi
  else
    warn "fail2ban is not available from this distribution's packages (RHEL family: enable EPEL first)."
  fi
fi
