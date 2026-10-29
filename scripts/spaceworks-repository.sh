#!/usr/bin/env bash
# Read only named configuration values; never execute the private .env as shell code.
repository_env_value() {
  local key="$1" value="" file="${SWB_STATIC_ENV_FILE:-$ROOT/.env}"
  if [[ -f "$file" ]]; then
    value="$(sed -n "s/^${key}=//p" "$file" | tail -n 1 | tr -d '\r')"
    if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; fi
  fi
  printf '%s' "$value"
}

configure_release_repository() {
  local owner key value
  SWB_REPOSITORY="${SWB_REPOSITORY:-$(repository_env_value SWB_REPOSITORY)}"
  SWB_REPOSITORY="${SWB_REPOSITORY:-SpaceWorks-Labs/SpaceWorks-Bookings}"
  [[ "$SWB_REPOSITORY" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9_.-]{1,100}$ ]] \
    && [[ "$SWB_REPOSITORY" != */. && "$SWB_REPOSITORY" != */.. ]] || {
    printf 'ERROR: SWB_REPOSITORY must be a GitHub owner/repo name.\n' >&2
    return 1
  }
  owner="$(printf '%s' "${SWB_REPOSITORY%%/*}" | tr '[:upper:]' '[:lower:]')"
  for key in SWB_BACKEND_IMAGE SWB_FRONTEND_IMAGE; do
    value="${!key:-$(repository_env_value "$key")}"
    if [[ -z "$value" ]]; then
      case "$key" in
        SWB_BACKEND_IMAGE) value="ghcr.io/$owner/spaceworks-bookings-backend" ;;
        SWB_FRONTEND_IMAGE) value="ghcr.io/$owner/spaceworks-bookings-frontend" ;;
      esac
    fi
    export "$key=$value"
  done
  export SWB_REPOSITORY
}

# The bundled services that serve requests, as this installation runs them.
serving_services() {
  SERVING_SERVICES=(backend worker beat)
  [[ "$(repository_env_value SWB_LAYER)" == proxy ]] || SERVING_SERVICES+=(caddy)
}

# The security-patched edge is built locally even when app images are published.
# An installation behind its own proxy has no bundled edge to build.
build_web_edge() {
  [[ "$(repository_env_value SWB_LAYER)" == proxy ]] || "${COMPOSE[@]}" build caddy
}

# Replace (or append) one named value in the private .env, keeping it owner-only.
# Single quotes keep the value literal for Compose, as setup-write-environment.sh writes it.
repository_env_set() {
  local key="$1" value="$2" file="${SWB_STATIC_ENV_FILE:-$ROOT/.env}" temporary
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ && "$value" != *$'\n'* ]] || return 1
  value="${value//\\/\\\\}"
  value="${value//\'/\\\'}"
  temporary="$(mktemp "$(dirname "$file")/.env.XXXXXX")"
  chmod 600 "$temporary"
  grep -v "^${key}=" "$file" > "$temporary" || true
  printf "%s='%s'\n" "$key" "$value" >> "$temporary"
  mv -f -- "$temporary" "$file"
}

# A GitHub token for a private repository (and its GHCR images): SWB_GITHUB_TOKEN,
# GITHUB_TOKEN or GH_TOKEN, else the GitHub CLI's own login. Never stored in .env.
github_token() {
  local token="${SWB_GITHUB_TOKEN:-${GITHUB_TOKEN:-${GH_TOKEN:-}}}"
  if [[ -z "$token" ]] && command -v gh >/dev/null 2>&1; then token="$(gh auth token 2>/dev/null || true)"; fi
  [[ -z "$token" || "$token" =~ ^[A-Za-z0-9_]+$ ]] || return 1
  printf '%s' "$token"
}

# curl for GitHub; the token goes through stdin, never the process list.
github_curl() {
  local token
  token="$(github_token)" || { printf 'ERROR: the GitHub token has unexpected characters.\n' >&2; return 1; }
  {
    [[ -z "$token" ]] || printf 'header = "Authorization: Bearer %s"\n' "$token"
  } | curl --config - --fail --silent --show-error --location --proto '=https' --connect-timeout 10 --max-time 600 \
    --retry 2 --retry-delay 5 --header 'User-Agent: swbook-self-host' "$@"
}

# Private GHCR images need a login before a pull; public ones need none.
ghcr_login() {
  local token user
  [[ "${SWB_BACKEND_IMAGE:-}" == ghcr.io/* ]] || return 0
  token="$(github_token)" || return 1
  [[ -n "$token" ]] || return 0
  user="${SWB_GITHUB_USER:-$(github_curl --header 'Accept: application/vnd.github+json' https://api.github.com/user 2>/dev/null \
    | sed -n 's/^ *"login" *: *"\([^"]*\)".*/\1/p' | head -n 1)}"
  printf '%s' "$token" | docker login ghcr.io --username "${user:-token}" --password-stdin >/dev/null \
    || { printf 'ERROR: GHCR refused the GitHub token; it needs the read:packages scope.\n' >&2; return 1; }
}
