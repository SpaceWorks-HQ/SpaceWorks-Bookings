#!/usr/bin/env bash
# Sourced only by the disposable compose smoke: never change existing public assets.
prepare_public_permission_probe() {
  PUBLIC_PERMISSION_PROBE=''
  OPS_PERMISSION_PROBE=''
  [[ "${CI:-}" == true && "${SWB_COMPOSE_BUILD_LAYER:-0}" == 1 ]] || return 0
  PUBLIC_PERMISSION_PROBE="$(mktemp -d "$ROOT/public/swb-permission-smoke.XXXXXX")"
  printf 'private-mode public asset\n' > "$PUBLIC_PERMISSION_PROBE/readable.txt"
  chmod 700 "$PUBLIC_PERMISSION_PROBE"
  chmod 600 "$PUBLIC_PERMISSION_PROBE/readable.txt"
  OPS_PERMISSION_PROBE="$(mktemp -d "$ROOT/docker/ops/swb-permission-smoke.XXXXXX")"
  printf 'private-mode operator asset\n' > "$OPS_PERMISSION_PROBE/readable.txt"
  chmod 700 "$OPS_PERMISSION_PROBE"
  chmod 600 "$OPS_PERMISSION_PROBE/readable.txt"
}

check_public_permission_probe() {
  [[ -n "${PUBLIC_PERMISSION_PROBE:-}" ]] || return 0
  docker run --rm --network none --entrypoint node "$SWB_BACKEND_IMAGE:$SWB_IMAGE_TAG" -e '
    const fs = require("node:fs"), assert = require("node:assert/strict");
    const directory = "/app/public/" + process.argv[1], file = directory + "/readable.txt";
    assert.notEqual(process.getuid(), 0, "probe must use the non-root image user");
    for (const path of [directory, file]) assert.equal(fs.statSync(path).uid, process.getuid());
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(directory), ["readable.txt"]);
    assert.equal(fs.readFileSync(file, "utf8"), "private-mode public asset\n");
    console.log("Non-root backend reads public directory700 and asset600.");
    const ops = "/app/docker/ops", probe = ops + "/" + process.argv[2];
    for (const path of [probe, probe + "/readable.txt", ops + "/check.mjs", ops + "/admin.mjs"]) {
      assert.equal(fs.statSync(path).uid, process.getuid());
    }
    assert.equal(fs.statSync(probe).mode & 0o777, 0o700);
    assert.equal(fs.statSync(probe + "/readable.txt").mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(probe), ["readable.txt"]);
    assert.equal(fs.readFileSync(probe + "/readable.txt", "utf8"), "private-mode operator asset\n");
    for (const name of ["check.mjs", "admin.mjs"]) assert.ok(fs.readFileSync(ops + "/" + name).length);
    console.log("Non-root backend reads private operator assets and actual check/admin tools.");
  ' "$(basename "$PUBLIC_PERMISSION_PROBE")" "$(basename "$OPS_PERMISSION_PROBE")"
}

remove_public_permission_probe() {
  if [[ -n "${OPS_PERMISSION_PROBE:-}" ]]; then
    case "$OPS_PERMISSION_PROBE" in "$ROOT/docker/ops/swb-permission-smoke."*) ;; *) return 1 ;; esac
    rm -f -- "$OPS_PERMISSION_PROBE/readable.txt"
    rmdir -- "$OPS_PERMISSION_PROBE"
  fi
  [[ -n "${PUBLIC_PERMISSION_PROBE:-}" ]] || return 0
  case "$PUBLIC_PERMISSION_PROBE" in "$ROOT/public/swb-permission-smoke."*) ;; *) return 1 ;; esac
  rm -f -- "$PUBLIC_PERMISSION_PROBE/readable.txt"
  rmdir -- "$PUBLIC_PERMISSION_PROBE"
}
