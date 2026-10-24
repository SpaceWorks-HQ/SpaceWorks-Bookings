#!/usr/bin/env bash
# shellcheck disable=SC2154 # ROOT, COMPOSE and the helpers come from update.sh, which sources this file
# Update an install that was built from source (install.sh --ref): download the ref,
# back up the database, copy the new tree over the install (the archive holds no
# .env, tls/ or backups/, so private state stays), rebuild the images here and
# restart. Built images replace the previous ones, so there is no automatic image
# rollback: the pre-update dump is the way back.
update_from_source() {
  local ref="$1" stage backup_name
  stage="$(mktemp -d "${TMPDIR:-/tmp}/.swbook-stage.XXXXXX")"
  export SWB_UPDATE_STAGE_DIR="$stage"
  say "Downloading $SWB_REPOSITORY at $ref."
  github "https://api.github.com/repos/$SWB_REPOSITORY/tarball/$ref" | tar -xz -C "$stage" --strip-components=1 --no-same-owner \
    || die "Could not download $ref from $SWB_REPOSITORY."
  [[ -f "$stage/Dockerfile" && -f "$stage/scripts/update.sh" && -f "$stage/docker-compose.prod.yml" ]] \
    || die "$ref does not look like a Space Works Bookings source tree."
  mkdir -p "$ROOT/backups"
  chmod 700 "$ROOT/backups"
  "${COMPOSE[@]}" up -d --wait db
  backup_name="pre-update-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  say "Creating database backup backups/$backup_name."
  "${COMPOSE[@]}" exec -T db pg_dump -U swbook -d swbook | gzip > "$ROOT/backups/$backup_name.partial" \
    && [[ "$(gzip -dc "$ROOT/backups/$backup_name.partial" | head -c 1 | wc -c | tr -d " ")" == 1 ]] \
    || { rm -f "$ROOT/backups/$backup_name.partial"; die "Database backup failed; update cancelled."; }
  chmod 600 "$ROOT/backups/$backup_name.partial"
  mv "$ROOT/backups/$backup_name.partial" "$ROOT/backups/$backup_name"
  cp -a -- "$stage/." "$ROOT/"
  export SWB_COMPOSE_BUILD_LAYER=1 SWB_IMAGE_TAG=local
  say "Building the images from $ref (this can take several minutes)."
  "${COMPOSE[@]}" build backend || die "The build failed; the running containers were not replaced."
  say "Running migrations and replacing application containers."
  "${COMPOSE[@]}" up -d --wait --wait-timeout 300 --remove-orphans \
    || die "The new build did not become healthy. The backup is backups/$backup_name (scripts/restore.sh)."
  "${COMPOSE[@]}" run --rm ops || die "The new build failed its operator checks. The backup is backups/$backup_name."
  printf '%s\n' local > "$ROOT/.spaceworks-version"
  printf '%s\n' "$ref" > "$ROOT/.spaceworks-source-ref"
  printf '%s\n' "$backup_name" > "$ROOT/.spaceworks-previous-backup"
  find "$ROOT/backups" -maxdepth 1 -type f -name 'pre-update-*.sql.gz' -mtime +14 -delete
  say "Update complete: $SWB_REPOSITORY at $ref, built on this server."
}
