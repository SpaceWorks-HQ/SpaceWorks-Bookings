#!/usr/bin/env bash
# The only supported way to run the production Compose stacks:
#   scripts/spaceworks-compose.sh bundled <compose arguments...>   docker-compose.prod.yml + overlays, ./.env
#   scripts/spaceworks-compose.sh cloud <compose arguments...>     docker-compose.cloud.yml, /etc/spaceworks-bookings/cloud.env
# Bundled overlays come from the install's settings: SWB_LAYER in .env (tls for
# automatic HTTPS, proxy for an existing reverse proxy), SWB_STORAGE=external,
# and SWB_COMPOSE_BUILD_LAYER=1 to build the images from this checkout.
set -euo pipefail

WRAPPER_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${SWB_UPDATE_INSTALL_DIR:-$(cd "$WRAPPER_SCRIPT_DIR/.." && pwd)}"
export SWB_UPDATE_INSTALL_DIR="$ROOT"
# shellcheck source=scripts/spaceworks-repository.sh
source "$WRAPPER_SCRIPT_DIR/spaceworks-repository.sh"
TOPOLOGY="${1:-}"
[[ "$TOPOLOGY" == "bundled" || "$TOPOLOGY" == "cloud" ]] || {
  echo "usage: scripts/spaceworks-compose.sh <bundled|cloud> [compose arguments...]" >&2
  exit 64
}
shift
for argument in "$@"; do
  case "$argument" in
    -f|--file|--file=*|-f*|--env-file|--env-file=*|--project-directory|--project-directory=*|-p|--project-name|--project-name=*)
      echo "Compose file, env-file, project and project-directory overrides are forbidden by the committed wrapper." >&2
      exit 64
      ;;
  esac
done

if [[ "$TOPOLOGY" == bundled ]]; then
  export SWB_STATIC_ENV_FILE="${SWB_STATIC_ENV_FILE:-$ROOT/.env}"
  COMPOSE_FILES=("$ROOT/docker-compose.prod.yml")
  PROJECT="${SWB_COMPOSE_PROJECT:-swbook}"
else
  export SWB_STATIC_ENV_FILE="${SWB_STATIC_ENV_FILE:-/etc/spaceworks-bookings/cloud.env}"
  COMPOSE_FILES=("$ROOT/docker-compose.cloud.yml")
  PROJECT="${SWB_COMPOSE_PROJECT:-swbook-cloud}"
fi
[[ -f "$SWB_STATIC_ENV_FILE" ]] || { echo "Missing $SWB_STATIC_ENV_FILE; run setup.sh (bundled) or create it from .env.production.example (cloud)." >&2; exit 66; }
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]] || { echo "Invalid SWB_COMPOSE_PROJECT." >&2; exit 64; }

# A curl install pins the exact release it installed; keep every later
# invocation on it unless the updater supplies a different tag in the shell.
if [[ -z "${SWB_IMAGE_TAG:-}" && -f "$ROOT/.spaceworks-version" ]]; then
  pinned_tag="$(tr -d '[:space:]' < "$ROOT/.spaceworks-version")"
  [[ "$pinned_tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "Invalid image tag in $ROOT/.spaceworks-version." >&2; exit 64; }
  export SWB_IMAGE_TAG="$pinned_tag"
fi
configure_release_repository

if [[ "$TOPOLOGY" == bundled ]]; then
  LAYER="$(repository_env_value SWB_LAYER)"
  case "${LAYER:-none}" in
    none) ;;
    tls) COMPOSE_FILES+=("$ROOT/docker/compose.tls.yml") ;;
    proxy) COMPOSE_FILES+=("$ROOT/docker/compose.proxy.yml") ;;
    *) echo "Unknown SWB_LAYER; use none, tls or proxy." >&2; exit 64 ;;
  esac
  [[ "$(repository_env_value SWB_STORAGE)" != external ]] || COMPOSE_FILES+=("$ROOT/docker/compose.external-storage.yml")
  if [[ "${SWB_COMPOSE_BUILD_LAYER:-0}" == 1 ]]; then
    COMPOSE_FILES+=("$ROOT/docker/compose.build.yml")
    # Builds compile with a throwaway Server Actions key; the real one is runtime-only.
    SWB_BUILD_KEY="${SWB_BUILD_KEY:-$(head -c 32 /dev/urandom | base64 | tr -d '\n')}"
    export SWB_BUILD_KEY COMPOSE_BAKE=false
  fi
elif [[ "${SWB_COMPOSE_BUILD_LAYER:-0}" == 1 ]]; then
  echo "Build overlays are available only for the bundled topology." >&2
  exit 64
fi

COMPOSE_ARGS=(--project-name "$PROJECT" --project-directory "$ROOT" --env-file "$SWB_STATIC_ENV_FILE")
for file in "${COMPOSE_FILES[@]}"; do COMPOSE_ARGS+=(-f "$file"); done
# Shell values outrank --env-file during interpolation: the saved settings are
# authoritative, even in an old operator shell.
unset PUBLIC_APP_BASE_URL SITE_ADDRESS CADDY_GLOBAL_OPTIONS TLS_EMAIL DATABASE_URL DIRECT_URL REDIS_URL \
  HTTP_PORT HTTP_PORT_BIND TLS_HTTPS_PORT API_BIND API_PORT APP_BIND APP_PORT COMPOSE_PROFILES
exec docker compose "${COMPOSE_ARGS[@]}" "$@"
