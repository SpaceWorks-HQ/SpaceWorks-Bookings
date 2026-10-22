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
  SWB_REPOSITORY="${SWB_REPOSITORY:-SpaceWorks-HQ/SpaceWorks-Bookings}"
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
  SERVING_SERVICES=(backend scheduler)
  [[ "$(repository_env_value SWB_LAYER)" == proxy ]] || SERVING_SERVICES+=(caddy)
}
