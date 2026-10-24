#!/usr/bin/env bash
# Sourced by host entry points. The directory owner also owns setup and updates.
require_install_owner() {
  local entrypoint="$1"; shift
  local owner current name key
  local forwarded=()
  [[ "$(uname -s)" == Linux ]] || return 0
  owner="$(stat -c %u "$ROOT")"
  current="$(id -u)"
  [[ "$owner" != "$current" ]] || return 0
  if [[ "$owner" == 0 ]]; then
    command -v sudo >/dev/null 2>&1 || {
      printf 'ERROR: %s is root-owned. Run sudo bash %q' "$ROOT" "$entrypoint" >&2
      printf ' %q' "$@" >&2; printf '\n' >&2
      exit 1
    }
    # Preserve only the host configuration knobs and an explicit GitHub token, never ambient secrets.
    for key in SWB_STATIC_ENV_FILE SWB_UPDATE_INSTALL_DIR SWB_COMPOSE_BUILD_LAYER SWB_COMPOSE_PROJECT \
      SWB_REPOSITORY SWB_INSTALL_REPOSITORY_PINNED SWB_RUNNER_DIR \
      SWB_IMAGE_TAG SWB_BACKEND_IMAGE SWB_FRONTEND_IMAGE SWB_GITHUB_TOKEN SWB_GITHUB_USER SWB_NONINTERACTIVE; do
      if [[ -n "${!key:-}" ]]; then export "${key?}"; forwarded+=("$key"); fi
    done
    printf 'Root-owned install: continuing as root using sudo.\n'
    # Names only: values (the token) stay out of the process list.
    local preserve=""
    ((${#forwarded[@]} == 0)) || preserve="--preserve-env=$(IFS=,; printf '%s' "${forwarded[*]}")"
    exec sudo ${preserve:+"$preserve"} bash "$entrypoint" "$@"
  fi
  name="$(stat -c %U "$ROOT")"
  printf 'ERROR: %s belongs to %s (UID %s). Sign in as that user and run bash %q' \
    "$ROOT" "$name" "$owner" "$entrypoint" >&2
  printf ' %q' "$@" >&2; printf '\n' >&2
  exit 1
}
