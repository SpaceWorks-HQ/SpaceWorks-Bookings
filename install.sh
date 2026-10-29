#!/usr/bin/env bash
# Space Works Bookings installer and maintenance menu:
#   curl -fsSL https://raw.githubusercontent.com/SpaceWorks-Labs/SpaceWorks-Bookings/main/install.sh | bash
# While the repository is private, fetch it with a token or the GitHub CLI (install.sh --help,
# "Private repository"). It is fetched alone (curl | bash), so it is one self-contained file
# and may exceed the ~300-line ceiling for that reason.
set -euo pipefail
DEFAULT_REPOSITORY=SpaceWorks-Labs/SpaceWorks-Bookings
ACTIONS=(update status backup backup-settings restore rollback reconfigure harden recover-admin support runner runner-remove uninstall cancel)
show_guide() {
  cat <<'EOF'

Space Works Bookings installer - installs the latest release (or a pinned release, or a
branch built from source) and, when run again, opens the maintenance menu.

What you need first
  - A 64-bit machine (x86_64 or arm64) running Linux (Debian/Ubuntu, Fedora/RHEL/Alma/
    Rocky, Arch or openSUSE), macOS, or Windows Git Bash/WSL.
  - Linux: root, or a user with sudo. The installer installs Docker, Docker Compose and
    curl after you confirm. macOS/Windows: Docker Desktop installed and running.
  - Internet access to github.com and ghcr.io, curl and tar, and 8 GiB free disk.
    For bundled Caddy builds, a 4 GiB RAM host with swap is recommended, including
    published-app installs and upgrades. Source app builds need about 4 GiB available.
  - The web address (a domain whose DNS points here for automatic HTTPS, or a host name
    or IP), the super-admin email and an SMTP relay login.

What it does
  1. Checks the machine. Nothing changes until those checks pass.
  2. Downloads the release into temporary storage and asks the deployment questions:
     website, HTTPS (automatic Caddy HTTPS, your own proxy, or plain HTTP), file storage
     (bundled Silo or your own S3/R2 bucket), super admin, email and the optional runner.
  3. Shows a summary and proceeds only after you confirm.
  4. Installs Docker if needed, copies the release into /opt/spaceworks-bookings, writes
     private settings with generated secrets (AUTH_SECRET, CRON_SECRET, MFA_ENCRYPTION_KEY,
     PAYMENT_SECRETS_KEY, database, Redis and Silo passwords) and TLS certificates, then
     starts PostgreSQL, Redis, Silo, migrations, the app, the job worker and beat,
     scheduled backups and Caddy, and runs the operator checks.

Run it again for the menu: update, check status, back up now, backup settings, restore,
roll back, change settings, server security, recover super-admin access, support bundle,
automatic deploys (runner) and uninstall.

Options
  --repo OWNER/NAME   install from a fork (default SpaceWorks-Labs/SpaceWorks-Bookings)
  --dir PATH          install directory (default /opt/spaceworks-bookings; env SWB_DIR)
  --release TAG       install this published release instead of the latest
  --ref REF           build this branch, tag or commit from source on this server
                      (no published images needed; updates rebuild the same ref)
  --action ACTION     on an existing install, run one menu entry without the menu:
                      update status backup backup-settings restore rollback reconfigure
                      harden recover-admin support runner runner-remove uninstall cancel
  --update            the same as --action update
  --non-interactive   never ask (also --yes, or SWB_NONINTERACTIVE=1): answers come from
                      SWB_ANSWER_<QUESTION> variables, for example SWB_ANSWER_HTTPS_MODE=2,
                      SWB_ANSWER_PUBLIC_DOMAIN, SWB_ANSWER_TLS_EMAIL, SWB_ANSWER_WEBHOST,
                      SWB_ANSWER_STORAGE, SWB_ANSWER_SUPER_ADMIN_EMAIL,
                      SWB_ANSWER_SUPER_ADMIN_PASSWORD, SWB_ANSWER_EMAIL_FROM,
                      SWB_ANSWER_SMTP_HOST, SWB_ANSWER_SMTP_USER, SWB_ANSWER_SMTP_PASSWORD
                      (see scripts/setup-questions.sh for every key and its default)
  --dry-run           run the checks (and, from a checkout, the questions), print what would
                      happen and change nothing; never downloads
  -h, --help          show this guide
  Environment equivalents: SWB_REPOSITORY, SWB_DIR, SWB_RELEASE, SWB_REF, SWB_ACTION,
  SWB_DRY_RUN=1.

Private repository
  The raw URL needs a GitHub token while the repository is private. Use one of:
    export GITHUB_TOKEN=<token with repo and read:packages>
    curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
      https://raw.githubusercontent.com/SpaceWorks-Labs/SpaceWorks-Bookings/main/install.sh | bash
  or, signed in with the GitHub CLI (gh auth login):
    gh api -H 'Accept: application/vnd.github.raw' \
      repos/SpaceWorks-Labs/SpaceWorks-Bookings/contents/install.sh | bash
  or: gh repo clone SpaceWorks-Labs/SpaceWorks-Bookings && bash SpaceWorks-Bookings/install.sh
  The installer then uses SWB_GITHUB_TOKEN, GITHUB_TOKEN or GH_TOKEN (else `gh auth token`)
  for the release download and the GHCR image pull. The token is never written to disk;
  Docker keeps its own ghcr.io login for later pulls.
EOF
}
say() { printf '[Space Works installer] %s\n' "$*"; }
die() { printf '[Space Works installer] ERROR: %s\n' "$*" >&2; exit 1; }
# A host problem stops a real install; a dry run reports it and carries on.
preflight_fail() { if [[ "${DRY_RUN:-0}" == 1 ]]; then say "Dry run: an install would stop here: $*"; else die "$*"; fi; }
usage() {
  printf 'Usage: install.sh [--repo OWNER/NAME] [--dir PATH] [--release TAG | --ref REF] [--action ACTION | --update] [--non-interactive] [--dry-run] [--help]\n' >&2
  exit 64
}
REPO_ARG="" RELEASE="${SWB_RELEASE:-}" SOURCE_REF="${SWB_REF:-}" REQUESTED_ACTION="${SWB_ACTION:-}" DRY_RUN="${SWB_DRY_RUN:-0}"
SWB_NONINTERACTIVE="${SWB_NONINTERACTIVE:-0}"
while (($# > 0)); do
  case "$1" in
    -h|--help) show_guide; exit 0 ;;
    --repo|--dir|--release|--ref|--action)
      (($# > 1)) || usage
      case "$1" in
        --repo) REPO_ARG="$2" ;; --dir) SWB_DIR="$2" ;; --release) RELEASE="$2" ;;
        --ref) SOURCE_REF="$2" ;; --action) REQUESTED_ACTION="$2" ;;
      esac
      shift ;;
    --repo=*) REPO_ARG="${1#*=}" ;;
    --dir=*) SWB_DIR="${1#*=}" ;;
    --release=*) RELEASE="${1#*=}" ;;
    --ref=*) SOURCE_REF="${1#*=}" ;;
    --action=*) REQUESTED_ACTION="${1#*=}" ;;
    --update) REQUESTED_ACTION=update ;;
    --non-interactive|--yes) SWB_NONINTERACTIVE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) usage ;;
  esac
  shift
done
[[ "$SWB_NONINTERACTIVE" =~ ^[01]$ && "$DRY_RUN" =~ ^[01]$ ]] || die 'SWB_NONINTERACTIVE and SWB_DRY_RUN must be 0 or 1.'
export SWB_NONINTERACTIVE
[[ -z "$RELEASE" || -z "$SOURCE_REF" ]] || die 'Use either --release or --ref, not both.'
RELEASE="${RELEASE#v}"
[[ -z "$RELEASE" || "$RELEASE" =~ ^[0-9]+\.[0-9]+\.[0-9]+-main\.[0-9]+\.[0-9a-f]{12}$ ]] \
  || die '--release needs a published main release such as v0.5.0-main.12.0123456789ab.'
[[ -z "$SOURCE_REF" || ( "$SOURCE_REF" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,150}$ && "$SOURCE_REF" != *..* ) ]] \
  || die '--ref needs a branch, tag or commit name.'
if [[ -n "$REQUESTED_ACTION" ]]; then
  [[ " ${ACTIONS[*]} " == *" $REQUESTED_ACTION "* ]] || die "Unknown action '$REQUESTED_ACTION'. Choose one of: ${ACTIONS[*]}."
fi
[[ -z "$REPO_ARG" ]] || SWB_REPOSITORY="$REPO_ARG"
REPOSITORY="${SWB_REPOSITORY:-$DEFAULT_REPOSITORY}"
INSTALL_DIR="${SWB_DIR:-/opt/spaceworks-bookings}"
# Run from a checkout (bash install.sh) rather than piped: the dry run can ask its questions.
LOCAL_SOURCE=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  LOCAL_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  [[ -f "$LOCAL_SOURCE/scripts/setup-questions.sh" ]] || LOCAL_SOURCE=""
fi
# A token unlocks a private repository and its GHCR images; it is never written to disk.
SWB_GITHUB_TOKEN="${SWB_GITHUB_TOKEN:-${GITHUB_TOKEN:-${GH_TOKEN:-}}}"
TOKEN_SOURCE=environment
if [[ -z "$SWB_GITHUB_TOKEN" ]] && command -v gh >/dev/null 2>&1; then
  SWB_GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"
  TOKEN_SOURCE='the GitHub CLI login'
fi
[[ -z "$SWB_GITHUB_TOKEN" || "$SWB_GITHUB_TOKEN" =~ ^[A-Za-z0-9_]+$ ]] || die 'The GitHub token has unexpected characters.'
export SWB_GITHUB_TOKEN
MIN_FREE_KB=$((8 * 1024 * 1024))
RUN_ROOT=()
SUDO=()
USE_DOCKER_GROUP=0
RUN_INSTALLED_AS_ROOT=0
ACTION=fresh
RELEASE_TAG=""
VERSION=""
STAGE_DIR=""
ARCHIVE=""
CREATED_PARENT=0
installed_ref=""
TTY_IN=/dev/tty
[[ "$SWB_NONINTERACTIVE" == 0 ]] || TTY_IN=/dev/null
prompt() {
  local reply
  [[ "$SWB_NONINTERACTIVE" == 0 ]] || die "This step needs an answer; pass it as an option (see --help)."
  [[ -r /dev/tty ]] || die "An interactive terminal is required (or use --non-interactive)."
  printf '%s' "$1" > /dev/tty
  IFS= read -r reply < /dev/tty || reply=""
  printf '%s' "${reply%$'\r'}"
}
# curl for GitHub; the token goes through stdin, never the process list.
github() {
  command -v curl >/dev/null 2>&1 || die 'curl is needed to download the release. Install curl, then rerun.'
  { [[ -z "$SWB_GITHUB_TOKEN" ]] || printf 'header = "Authorization: Bearer %s"\n' "$SWB_GITHUB_TOKEN"; } \
    | curl --config - --fail --silent --show-error --location --proto '=https' --connect-timeout 10 --retry 2 \
      --header 'Accept: application/vnd.github+json' --header 'User-Agent: swbook-curl-installer' "$@"
}
not_found_hint() {
  if [[ -z "$SWB_GITHUB_TOKEN" ]]; then
    printf 'If %s is private, export GITHUB_TOKEN (scopes repo and read:packages) or sign in with gh auth login, then rerun.' "$REPOSITORY"
  else
    printf 'The token from %s was sent; check that it can read %s.' "$TOKEN_SOURCE" "$REPOSITORY"
  fi
}
cleanup() {
  if [[ -n "$STAGE_DIR" && "$STAGE_DIR" == */.swbook-stage.* ]]; then
    rm -rf -- "$STAGE_DIR" 2>/dev/null || true
  fi
  [[ -z "$ARCHIVE" ]] || rm -f -- "$ARCHIVE"
  if [[ "$CREATED_PARENT" == 1 ]]; then
    ${RUN_ROOT[@]+"${RUN_ROOT[@]}"} rmdir -- "$(dirname "$INSTALL_DIR")" 2>/dev/null || true
  fi
}
trap cleanup EXIT
case "$INSTALL_DIR" in
  ""|/|*"'"*|*$'\n'*) die "SWB_DIR must be a specific path without single quotes or newlines." ;;
esac
while [[ "$INSTALL_DIR" == */ ]]; do INSTALL_DIR="${INSTALL_DIR%/}"; done
[[ -n "$INSTALL_DIR" ]] || die "SWB_DIR cannot be the filesystem root."
[[ "$INSTALL_DIR" == /* ]] || INSTALL_DIR="$PWD/$INSTALL_DIR"
[[ "$SWB_NONINTERACTIVE" == 1 || "$DRY_RUN" == 1 ]] || show_guide
[[ "$DRY_RUN" == 0 ]] || say 'Dry run: checks only. Nothing is downloaded, installed or changed.'
say "Preflight only—nothing will be installed until all checks pass."
[[ -z "$SWB_GITHUB_TOKEN" ]] || say "Using a GitHub token from $TOKEN_SOURCE for $REPOSITORY and ghcr.io."
say "Checking architecture, operating system, dependencies, Docker, release availability, ports, disk space, and existing state."
machine="$(uname -m)"
case "$machine" in
  x86_64|amd64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=aarch64 ;;
  *) die "Unsupported architecture '$machine'. Release images support only x86_64 and aarch64." ;;
esac
kernel="$(uname -s)"
PACKAGE_FAMILY=""
case "$kernel" in
  Linux)
    [[ -r /etc/os-release ]] || die "Linux distribution metadata /etc/os-release is missing."
    # /etc/os-release is the distribution's canonical data source. Do not infer
    # the family from whichever package-manager binary happens to be present.
    ID=""; ID_LIKE=""
    # shellcheck disable=SC1091
    source /etc/os-release
    distro_words=" ${ID:-} ${ID_LIKE:-} "
    case "$distro_words" in
      *" debian "*|*" ubuntu "*|*" linuxmint "*) PACKAGE_FAMILY=apt ;;
      *" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*) PACKAGE_FAMILY=dnf ;;
      *" arch "*|*" manjaro "*) PACKAGE_FAMILY=pacman ;;
      *" suse "*|*" opensuse "*|*" sles "*) PACKAGE_FAMILY=zypper ;;
      *) die "Unsupported Linux distribution '${ID:-unknown}' (ID_LIKE='${ID_LIKE:-}'). Supported families: Debian/Ubuntu, RHEL/Fedora/Alma/Rocky, Arch, and SUSE." ;;
    esac
    HOST_KIND=linux
    ;;
  MINGW*|MSYS*|CYGWIN*) HOST_KIND=windows ;;
  Darwin) HOST_KIND=macos ;;
  *) die "Unsupported host '$kernel'. Use Linux, Windows Git Bash, or macOS with Docker Desktop." ;;
esac
say "Architecture: $ARCH; host: $HOST_KIND${PACKAGE_FAMILY:+/$PACKAGE_FAMILY}."
# Host privilege and install-directory privilege are independent decisions.
if [[ "$HOST_KIND" == linux && "$(id -u)" != 0 ]]; then
  command -v sudo >/dev/null 2>&1 && SUDO=(sudo)
  # Releases stage beside the install, including on a user-owned /opt rerun.
  write_path="$(dirname "$INSTALL_DIR")"
  while [[ ! -e "$write_path" ]]; do write_path="$(dirname "$write_path")"; done
  if [[ ! -w "$write_path" || ( -d "$INSTALL_DIR" && ! -x "$INSTALL_DIR" ) ]]; then
    ((${#SUDO[@]} > 0)) || preflight_fail "Writing $INSTALL_DIR requires sudo. Install sudo or run this installer as root."
    RUN_ROOT=(sudo "--preserve-env=SWB_GITHUB_TOKEN,SWB_NONINTERACTIVE")
  fi
elif [[ "$(id -u)" == 0 ]]; then
  RUN_INSTALLED_AS_ROOT=1
fi
missing=()
MISSING_DOCKER=0
MISSING_COMPOSE=0
command -v curl >/dev/null 2>&1 || missing+=(curl)
command -v tar >/dev/null 2>&1 || missing+=(tar)
if ! command -v docker >/dev/null 2>&1; then
  missing+=(docker-engine docker-compose-v2)
  MISSING_DOCKER=1
  MISSING_COMPOSE=1
elif ! docker compose version >/dev/null 2>&1; then
  missing+=(docker-compose-v2)
  MISSING_COMPOSE=1
fi
if ((${#missing[@]} > 0)); then
  if [[ "$HOST_KIND" != linux ]]; then
    preflight_fail "Missing: ${missing[*]}. Install Docker Desktop (with Compose V2), curl, and tar, then rerun."
  fi
  if [[ "$(id -u)" != 0 ]]; then
    ((${#SUDO[@]} > 0)) || preflight_fail "Missing ${missing[*]} and sudo is unavailable. Install them as root, then rerun."
  fi
  say "After preflight, the $PACKAGE_FAMILY family installer will install/ensure: curl, tar, Docker Engine, and Docker Compose V2."
else
  say "Dependencies are already present."
fi
if command -v docker >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
  if [[ "$HOST_KIND" == linux ]]; then
    say "Docker is installed but stopped/inaccessible; after preflight the installer will start it or configure docker-group access."
  else
    preflight_fail "Docker Desktop is installed but not running. Start it and wait until it is ready, then rerun; no state was changed."
  fi
fi
as_install_root() { ${RUN_ROOT[@]+"${RUN_ROOT[@]}"} "$@"; }
choose_action() {
  local reply
  reply="$(prompt "
Space Works Bookings is already installed in $INSTALL_DIR ($1).
What do you want to do?
  1) Update - back up the database, move to the newest release (or rebuild the source
     ref it was installed from), run migrations and restart. Settings and data stay.
  2) Check status - release, services, the job worker and beat, disk and newest backup.
  3) Back up now - database, uploaded files and settings into backups/.
  4) Backup settings - how often scheduled backups run and how long they are kept.
  5) Restore from a backup - choose a dump in backups/; the site is offline meanwhile.
  6) Roll back - return to the release that ran before the last update.
  7) Change settings - web address, outgoing email or external bucket keys.
  8) Server security - firewall, automatic security updates and fail2ban.
  9) Recover super-admin access - lost authenticator or password, or a new super admin.
  10) Support bundle - checks and logs, secrets redacted, for troubleshooting.
  11) Automatic deploys - install or remove the GitHub Actions runner.
  12) Uninstall.
  0) Cancel - change nothing.
Choose 0-12 [0]: ")"
  case "${reply:-0}" in
    1) printf update ;; 2) printf status ;; 3) printf backup ;; 4) printf backup-settings ;;
    5) printf restore ;; 6) printf rollback ;; 7) printf reconfigure ;; 8) printf harden ;;
    9) printf recover-admin ;; 10) printf support ;; 12) printf uninstall ;; 0) printf cancel ;;
    11)
      reply="$(prompt 'Install (or re-register) the runner, or remove it? [I/r]: ')"
      case "${reply:-i}" in i|I) printf runner ;; r|R) printf runner-remove ;; *) printf invalid ;; esac ;;
    *) printf invalid ;;
  esac
}
# run_tool SCRIPT [ARGS...]: one menu entry, run from the installed release, then exit.
# Each script re-runs itself as the install owner (sudo for a root-owned install).
run_tool() {
  local script="$1"; shift
  as_install_root test -f "$INSTALL_DIR/scripts/$script" \
    || die "This installation has no scripts/$script yet. Choose Update first, then rerun."
  if [[ "$DRY_RUN" == 1 ]]; then say "Dry run: would run scripts/$script${*:+ $*}"; exit 0; fi
  set +e
  bash "$INSTALL_DIR/scripts/$script" "$@" < "$TTY_IN"
  exit $?
}
if as_install_root test -f "$INSTALL_DIR/.spaceworks-version"; then
  installed_version="$(as_install_root cat "$INSTALL_DIR/.spaceworks-version" 2>/dev/null || echo unknown)"
  installed_ref="$(as_install_root cat "$INSTALL_DIR/.spaceworks-source-ref" 2>/dev/null || true)"
  label="version $installed_version"
  [[ -z "$installed_ref" ]] || label="built from $installed_ref"
  ACTION="${REQUESTED_ACTION:-}"
  [[ -n "$ACTION" ]] || ACTION="$(choose_action "$label")"
  [[ "$ACTION" != invalid ]] || die "Invalid menu choice; the existing deployment was not changed."
  [[ "$ACTION" != cancel ]] || { say "Cancelled; the existing deployment was not changed."; exit 0; }
  as_install_root test -f "$INSTALL_DIR/scripts/update.sh" || die "The version marker exists but scripts/update.sh is missing. Repair the install manually."
  if [[ "$(id -u)" != 0 ]] && { [[ ! -w "$INSTALL_DIR" ]] \
    || { [[ "$HOST_KIND" == linux ]] && [[ "$(stat -c %u "$INSTALL_DIR")" == 0 ]]; }; }; then
    command -v sudo >/dev/null 2>&1 || die "The existing install is not writable and sudo is unavailable."
    RUN_ROOT=(sudo "--preserve-env=SWB_GITHUB_TOKEN,SWB_NONINTERACTIVE")
    RUN_INSTALLED_AS_ROOT=1
  fi
  case "$ACTION" in
    status) run_tool status.sh ;;
    backup) run_tool backup.sh ;;
    backup-settings) run_tool backup-settings.sh ;;
    restore) run_tool restore.sh ;;
    reconfigure) run_tool reconfigure.sh ;;
    harden) run_tool harden.sh ;;
    recover-admin) run_tool recover-admin.sh ;;
    support) run_tool support-bundle.sh ;;
    runner) run_tool install-runner.sh ;;
    runner-remove) run_tool install-runner.sh --remove ;;
    uninstall) run_tool uninstall.sh ;;
    update|rollback) [[ "$ACTION" == update || -z "$installed_ref" ]] || die "A source build has no earlier release to roll back to; restore backups/pre-update-*.sql.gz instead." ;;
  esac
elif [[ -n "$REQUESTED_ACTION" ]]; then
  die "No Space Works Bookings installation in $INSTALL_DIR for --action $REQUESTED_ACTION (set SWB_DIR or --dir)."
elif as_install_root test -e "$INSTALL_DIR"; then
  if as_install_root test -d "$INSTALL_DIR" && [[ -z "$(as_install_root find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    EMPTY_INSTALL_DIR=1
  else
    die "$INSTALL_DIR already contains state but has no .spaceworks-version marker. Refusing to reuse or overwrite it."
  fi
else
  EMPTY_INSTALL_DIR=0
fi
port_in_use() {
  local port="$1" hex file
  if [[ "$HOST_KIND" == linux ]]; then
    printf -v hex '%04X' "$port"
    for file in /proc/net/tcp /proc/net/tcp6; do
      [[ -r "$file" ]] || continue
      awk -v wanted="$hex" 'NR > 1 { split($2, address, ":"); if (toupper(address[2]) == wanted && $4 == "0A") exit 7 }' "$file" || return 0
    done
    return 1
  fi
  netstat -an 2>/dev/null | awk -v pattern="[:.]${port}[[:space:]]" \
    'toupper($0) ~ /LISTEN/ && $0 ~ pattern { found=1 } END { exit !found }'
}
disk_path="$INSTALL_DIR"
while [[ ! -e "$disk_path" && "$disk_path" != / ]]; do disk_path="$(dirname "$disk_path")"; done
available_kb="$(df -Pk "$disk_path" | awk 'NR == 2 {print $4}')"
[[ "$available_kb" =~ ^[0-9]+$ ]] || die "Could not determine free disk space for $INSTALL_DIR."
((available_kb >= MIN_FREE_KB)) || preflight_fail "At least 8 GiB free is required; $disk_path has $((available_kb / 1024)) MiB."
say "Disk-space check passed."
# The repository selects the release archive itself, so this first question precedes
# its download and every host change. The full summary repeats the choice.
if [[ -z "${SWB_REPOSITORY:-}" ]] && as_install_root test -f "$INSTALL_DIR/.env"; then
  configured="$(as_install_root sed -n 's/^SWB_REPOSITORY=//p' "$INSTALL_DIR/.env" | tail -n 1 | tr -d '\r')"
  configured="${configured#\'}"; configured="${configured%\'}"
  configured="${configured#\"}"; configured="${configured%\"}"
  REPOSITORY="${configured:-$REPOSITORY}"
fi
if [[ "$ACTION" == fresh && -z "${SWB_REPOSITORY:-}" && "$SWB_NONINTERACTIVE" == 0 ]]; then
  configured="$(prompt "
Which GitHub repository should this server install and update from?
  Press Enter for the main project, or type your fork as owner/name (e.g. YourName/SpaceWorks-Bookings).
  The fork must have run its release workflow at least once (or install a branch with --ref).
GitHub repository [$REPOSITORY]: ")"
  REPOSITORY="${configured:-$REPOSITORY}"
fi
[[ "$REPOSITORY" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9_.-]{1,100}$ ]] \
  && [[ "$REPOSITORY" != */. && "$REPOSITORY" != */.. ]] || die 'SWB_REPOSITORY must be a GitHub owner/repo name.'
export SWB_REPOSITORY="$REPOSITORY"
export SWB_INSTALL_REPOSITORY_PINNED=1
command -v tar >/dev/null 2>&1 || die 'tar is needed to read the release. Install tar, then rerun.'
if [[ "$DRY_RUN" == 1 ]]; then
  case "$ACTION" in
    update) say "Dry run: would update $INSTALL_DIR from $REPOSITORY${installed_ref:+ (rebuilding $installed_ref)}." ;;
    rollback) say "Dry run: would roll $INSTALL_DIR back to the previous release." ;;
    fresh)
      if [[ -n "$SOURCE_REF" ]]; then source_label="$REPOSITORY at $SOURCE_REF, built from source on this server"
      elif [[ -n "$RELEASE" ]]; then source_label="release v$RELEASE of $REPOSITORY"
      else source_label="the latest release of $REPOSITORY"; fi
      say "Dry run: would install $source_label into $INSTALL_DIR."
      if [[ -n "$LOCAL_SOURCE" ]]; then
        # shellcheck source=scripts/setup-questions.sh
        source "$LOCAL_SOURCE/scripts/setup-questions.sh"
        SETUP_HOST_PLAN="nothing (dry run)"
        ask_setup_questions || exit 1
      fi ;;
  esac
  say 'Dry run complete; nothing was changed.'
  exit 0
fi
say 'Host preflight passed; fetching the release into temporary storage.'
if [[ "$ACTION" == fresh ]]; then
  if [[ -n "$SOURCE_REF" ]]; then
    RELEASE_TAG="$SOURCE_REF"
    VERSION=local
    say "Building $REPOSITORY at $SOURCE_REF from source."
  else
    if [[ -n "$RELEASE" ]]; then
      RELEASE_TAG="v$RELEASE"
    else
      release_json="$(github "https://api.github.com/repos/$REPOSITORY/releases/latest")" \
        || die "No published release found for $REPOSITORY. $(not_found_hint) A fork must run its 'Continuous Release' workflow on main once, or install a branch with --ref main."
      RELEASE_TAG="$(printf '%s' "$release_json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    fi
    VERSION="${RELEASE_TAG#v}"
    [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-main\.[0-9]+\.[0-9a-f]{12}$ ]] \
      || die "Unexpected release tag: ${RELEASE_TAG:-<empty>}"
    say "Pinned release: $RELEASE_TAG."
  fi
  ARCHIVE="$(mktemp)"
  STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/.swbook-stage.XXXXXX")"
  github "https://api.github.com/repos/$REPOSITORY/tarball/$RELEASE_TAG" -o "$ARCHIVE" \
    || die "Could not download $RELEASE_TAG from $REPOSITORY. $(not_found_hint)"
  tar -xzf "$ARCHIVE" -C "$STAGE_DIR" --strip-components=1 --no-same-owner
  for required in setup.sh scripts/setup-questions.sh scripts/setup-question-input.sh scripts/update.sh \
    scripts/spaceworks-compose.sh docker-compose.prod.yml scripts/spaceworks-repository.sh \
    scripts/install-host-bundle.sh scripts/install-runner.sh; do
    [[ -f "$STAGE_DIR/$required" ]] || die "The downloaded release is missing $required."
  done
  # shellcheck source=scripts/setup-questions.sh
  source "$STAGE_DIR/scripts/setup-questions.sh"
  build_note="pull images"
  [[ -z "$SOURCE_REF" ]] || build_note="build the images from source (several minutes)"
  SETUP_HOST_PLAN="install/ensure ${missing[*]:-no missing packages}; enable Docker/access if needed; install $RELEASE_TAG in $INSTALL_DIR; write private settings; write TLS certificates; $build_note; apply migrations; start services and scheduled backups; install the optional GitHub Actions runner"
  ask_setup_questions || exit 0
  persist_setup_answers "$STAGE_DIR/.spaceworks-answers"
  ports=()
  if [[ "$HTTPS_MODE" == 2 ]]; then ports+=(80 443)
  elif [[ "$HTTPS_MODE" == 3 ]]; then ports+=(8080)
  else ports+=(80); fi
  for port in "${ports[@]}"; do
    port_in_use "$port" && die "TCP port $port is already in use. Free it before installing."
  done
  if ((${#ports[@]} == 1)); then say "Required TCP port ${ports[0]} is free."; else say "Required TCP ports ${ports[*]} are free."; fi
fi
install_linux_dependencies() {
  local runner_packages=()
  [[ "${INSTALL_RUNNER:-N}" =~ ^[Yy] ]] && runner_packages=(python3)
  case "$PACKAGE_FAMILY" in
    apt)
      ${SUDO[@]+"${SUDO[@]}"} apt-get update
      ${SUDO[@]+"${SUDO[@]}"} env DEBIAN_FRONTEND=noninteractive apt-get install -y curl tar ${runner_packages[@]+"${runner_packages[@]}"}
      [[ "$MISSING_DOCKER" == 0 ]] \
        || ${SUDO[@]+"${SUDO[@]}"} env DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io
      if [[ "$MISSING_COMPOSE" == 1 ]]; then
        ${SUDO[@]+"${SUDO[@]}"} env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-v2 \
          || ${SUDO[@]+"${SUDO[@]}"} env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin \
          || true
      fi
      ;;
    dnf)
      manager=dnf; command -v dnf >/dev/null 2>&1 || manager=yum
      ${SUDO[@]+"${SUDO[@]}"} "$manager" install -y curl tar ${runner_packages[@]+"${runner_packages[@]}"}
      if [[ "$MISSING_DOCKER" == 1 ]]; then
        repo_os=centos
        [[ "${ID:-}" == fedora ]] && repo_os=fedora
        [[ "${ID:-}" == rhel ]] && repo_os=rhel
        if [[ "$manager" == dnf ]]; then
          ${SUDO[@]+"${SUDO[@]}"} dnf install -y dnf-plugins-core
          ${SUDO[@]+"${SUDO[@]}"} dnf config-manager --add-repo "https://download.docker.com/linux/$repo_os/docker-ce.repo" \
            || ${SUDO[@]+"${SUDO[@]}"} dnf config-manager addrepo --from-repofile="https://download.docker.com/linux/$repo_os/docker-ce.repo"
        else
          ${SUDO[@]+"${SUDO[@]}"} yum install -y yum-utils
          ${SUDO[@]+"${SUDO[@]}"} yum-config-manager --add-repo "https://download.docker.com/linux/$repo_os/docker-ce.repo"
        fi
        ${SUDO[@]+"${SUDO[@]}"} "$manager" install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      else
        ${SUDO[@]+"${SUDO[@]}"} "$manager" install -y docker-compose-plugin || true
      fi
      ;;
    pacman) ${SUDO[@]+"${SUDO[@]}"} pacman -Sy --noconfirm --needed curl tar docker docker-compose ${runner_packages[@]+"${runner_packages[@]}"} ;;
    zypper) ${SUDO[@]+"${SUDO[@]}"} zypper --non-interactive install curl tar docker docker-compose ${runner_packages[@]+"${runner_packages[@]}"} ;;
  esac
}
if ((${#missing[@]} > 0)); then install_linux_dependencies
elif [[ "${INSTALL_RUNNER:-N}" =~ ^[Yy] ]] && ! command -v python3 >/dev/null 2>&1; then
  install_linux_dependencies
fi
if ! docker compose version >/dev/null 2>&1; then
  compose_json="$(curl --fail --silent --show-error --location \
    --header 'Accept: application/vnd.github+json' \
    --header 'User-Agent: swbook-curl-installer' \
    https://api.github.com/repos/docker/compose/releases/latest)"
  compose_tag="$(printf '%s' "$compose_json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  [[ "$compose_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Could not resolve a Docker Compose V2 plugin release."
  compose_url="https://github.com/docker/compose/releases/download/$compose_tag/docker-compose-linux-$ARCH"
  compose_tmp="$(mktemp)"
  curl --fail --silent --show-error --location "$compose_url" -o "$compose_tmp"
  # Docker publishes a SHA-256 beside every binary; refuse a download that doesn't match it.
  compose_sum="$(curl --fail --silent --show-error --location "$compose_url.sha256" | awk '{print $1}')"
  [[ "$compose_sum" =~ ^[0-9a-f]{64}$ ]] || { rm -f "$compose_tmp"; die "Could not fetch the Docker Compose checksum."; }
  printf '%s  %s\n' "$compose_sum" "$compose_tmp" | sha256sum -c - >/dev/null 2>&1 || { rm -f "$compose_tmp"; die "The Docker Compose download didn't match its published checksum."; }
  ${SUDO[@]+"${SUDO[@]}"} install -m 0755 -d /usr/local/lib/docker/cli-plugins
  ${SUDO[@]+"${SUDO[@]}"} install -m 0755 "$compose_tmp" /usr/local/lib/docker/cli-plugins/docker-compose
  rm -f "$compose_tmp"
fi
if ! docker info >/dev/null 2>&1; then
  if [[ "$HOST_KIND" == linux ]] && command -v systemctl >/dev/null 2>&1; then
    ${SUDO[@]+"${SUDO[@]}"} systemctl enable --now docker >/dev/null 2>&1 || true
  fi
fi
if ! docker info >/dev/null 2>&1; then
  if [[ "$HOST_KIND" == linux && "$(id -u)" != 0 && ${#SUDO[@]} -gt 0 ]] && ${SUDO[@]+"${SUDO[@]}"} docker info >/dev/null 2>&1; then
    if [[ "$RUN_INSTALLED_AS_ROOT" == 0 ]]; then
      operator="$(id -un)"
      ${SUDO[@]+"${SUDO[@]}"} usermod -aG docker "$operator" \
        || die "Run sudo usermod -aG docker '$operator' (if the group is missing, run sudo groupadd docker first), sign out and back in, then rerun."
      command -v sg >/dev/null 2>&1 || die "Docker access needs refreshed group membership. Sign out, sign in, and rerun this installer."
      sg docker -c 'docker info >/dev/null 2>&1' || die "Docker is still inaccessible inside the docker group. Sign out and back in, test docker info, and rerun; if needed, configure Docker's socket group before retrying."
      USE_DOCKER_GROUP=1
      say "Added $operator to the docker group; setup will use that group for this run."
    fi
  else
    die "Docker is inaccessible. Run sudo systemctl start docker; then test sudo docker info. For user access, run sudo usermod -aG docker \$(id -un), sign out and back in, then rerun."
  fi
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose V2 is still unavailable after dependency setup."
run_installed() {
  local command="$1"
  if [[ "$RUN_INSTALLED_AS_ROOT" == 1 ]]; then
    ${RUN_ROOT[@]+"${RUN_ROOT[@]}"} bash -c "cd '$INSTALL_DIR' && $command" < "$TTY_IN"
  elif [[ "$USE_DOCKER_GROUP" == 1 ]]; then
    sg docker -c "cd '$INSTALL_DIR' && $command" < "$TTY_IN"
  else
    (cd "$INSTALL_DIR" && bash -c "$command" < "$TTY_IN")
  fi
}
if [[ "$ACTION" != fresh ]]; then
  # The installed updater downloads the target and hands over to its own updater.
  update_options="--force"
  [[ "$ACTION" != rollback ]] || update_options="--force --rollback"
  [[ -z "$installed_ref" ]] || update_options="--force --source '$installed_ref'"
  [[ "$ACTION" != update || -z "$RELEASE" ]] || update_options="--force --version '$RELEASE'"
  [[ "$ACTION" != update || -z "$SOURCE_REF" ]] || update_options="--force --source '$SOURCE_REF'"
  run_installed "SWB_REPOSITORY='$REPOSITORY' bash scripts/update.sh $update_options"
  exit 0
fi
as_install_root chmod 755 "$STAGE_DIR/install.sh" "$STAGE_DIR/scripts/spaceworks-compose.sh"
if [[ "${EMPTY_INSTALL_DIR:-0}" == 1 ]]; then as_install_root rmdir -- "$INSTALL_DIR"; fi
parent="$(dirname "$INSTALL_DIR")"
if [[ ! -d "$parent" ]]; then as_install_root mkdir -p -- "$parent"; CREATED_PARENT=1; fi
# Temporary storage may be on another filesystem; keep answers private during copying.
as_install_root bash -c 'umask 077; mkdir -- "$1"' _ "$INSTALL_DIR"
as_install_root cp -a -- "$STAGE_DIR/." "$INSTALL_DIR/"
if [[ -f "$INSTALL_DIR/.spaceworks-answers" ]]; then
  as_install_root chmod 600 "$INSTALL_DIR/.spaceworks-answers"
fi
if [[ "$(id -u)" != 0 && ${#RUN_ROOT[@]} -gt 0 ]]; then
  as_install_root chown "$(id -u):$(id -g)" "$INSTALL_DIR"
fi
CREATED_PARENT=0
setup_options=""
[[ -z "$SOURCE_REF" ]] || setup_options="--build"
run_installed "SWB_INSTALL_REPOSITORY_PINNED=1 SWB_REPOSITORY='$REPOSITORY' SWB_IMAGE_TAG='$VERSION' bash setup.sh $setup_options"
as_install_root rm -f -- "$INSTALL_DIR/.spaceworks-answers"
run_installed "printf '%s\\n' '$VERSION' > .spaceworks-version"
if [[ -n "$SOURCE_REF" ]]; then
  run_installed "printf '%s\\n' '$SOURCE_REF' > .spaceworks-source-ref"
  say "Installed Space Works Bookings from $REPOSITORY at $SOURCE_REF (built here) in $INSTALL_DIR."
else
  say "Installed Space Works Bookings $VERSION in $INSTALL_DIR."
fi
say "Run this installer again for the maintenance menu (update, status, backups, restore and more)."
