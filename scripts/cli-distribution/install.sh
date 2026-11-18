#!/bin/sh
# Install a prebuilt platform payload. No Node, npm, compiler or lifecycle scripts.
set -eu
prefix=${LATTICE_INSTALL_PREFIX:-"$HOME/.local/share/lattice"}
bin=${LATTICE_INSTALL_BIN:-"$HOME/.local/bin"}
base=${LATTICE_DOWNLOAD_BASE:-https://github.com/qxchuckle/lattice/releases/latest/download}
from=
version=
fail() { echo "Lattice: $*" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix|--bin|--from|--version) [ "$#" -ge 2 ] || fail "missing option value"; key=$1; value=$2; shift 2
      case $key in --prefix) prefix=$value;; --bin) bin=$value;; --from) from=$value;; --version) version=$value;; esac ;;
    *) fail "unknown option: $1" ;;
  esac
done
case $prefix:$bin in /*:/*) ;; *) fail "prefix and bin must be absolute paths";; esac
case $(uname -s) in Darwin) platform=darwin;; Linux) platform=linux;; *) fail "unsupported OS (use the Windows npm package)";; esac
case $(uname -m) in arm64|aarch64) arch=arm64;; x86_64|amd64) arch=x64;; *) fail "unsupported architecture";; esac
if [ "$platform" = linux ]; then
  (ldd --version 2>&1 || true) | head -1 | grep -qi musl && fail "musl is not supported"
fi
mkdir -p "$prefix/versions" "$bin"
prefix=$(CDPATH= cd -- "$prefix" && pwd -P)
bin=$(CDPATH= cd -- "$bin" && pwd -P)
stage=
bin_lock=
prefix_lock=
lock_host=$(uname -n)
cleanup() {
  [ -z "$stage" ] || rm -rf "$stage" || :
  [ -z "$prefix_lock" ] || rmdir "$prefix_lock" || :
  [ -z "$bin_lock" ] || rmdir "$bin_lock" || :
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
# Publish a unique claim before scanning for other owners. Contenders can both stop,
# but only one can enter. Removing a dead owner's unique claim cannot remove a new owner's lock.
check_claims() {
  lock_base=$1
  own_claim=$2
  if [ -e "$lock_base" ] || [ -L "$lock_base" ]; then
    fail "legacy or unknown installation lock: $lock_base"
  fi
  for claim in "$lock_base".*; do
    [ "$claim" != "$own_claim" ] || continue
    [ -e "$claim" ] || [ -L "$claim" ] || continue
    case $claim in
      "$lock_base.$lock_host."*) owner=${claim#"$lock_base.$lock_host."}; owner=${owner%%.*};;
      *) fail "unknown or remote installation owner: $claim";;
    esac
    case $owner in ''|0|*[!0-9]*) fail "unknown installation owner: $claim";; esac
    if kill -0 "$owner" 2>/dev/null || ps -p "$owner" -o pid= >/dev/null 2>&1; then
      fail "another installation owns $claim (PID $owner)"
    fi
    rmdir "$claim" 2>/dev/null || { [ ! -e "$claim" ] && [ ! -L "$claim" ]; } ||
      fail "cannot recover installation lock: $claim"
  done
}
case $lock_host in ''|*[!a-zA-Z0-9._-]*) fail "unsupported hostname for installation locking";; esac
bin_lock=$(mktemp -d "$bin/.lattice-install-lock.$lock_host.$$.XXXXXXXX")
check_claims "$bin/.lattice-install-lock" "$bin_lock"
prefix_lock=$(mktemp -d "$prefix/.install-lock.$lock_host.$$.XXXXXXXX")
check_claims "$prefix/.install-lock" "$prefix_lock"
if [ -e "$prefix/current" ] || [ -L "$prefix/current" ]; then
  [ -L "$prefix/current" ] || fail "preserving existing current path"
  case $(readlink "$prefix/current") in "$prefix"/versions/*) ;; *) fail "preserving foreign current link";; esac
fi
stage=$(mktemp -d "$prefix/versions/.install-XXXXXXXX")
fetch() {
  if [ -n "$from" ]; then cp "$from/$1" "$2"
  else curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 "$base/$1" -o "$2"; fi
}
if [ -z "$version" ]; then fetch release-version.txt "$stage/version"; version=$(cat "$stage/version"); fi
case $version in ''|*[!0-9a-zA-Z.+-]*) fail "invalid version";; esac
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$' || fail "invalid version"
# Resolve latest exactly once, then fetch all metadata/artifacts from that immutable tag.
if [ -z "$from" ]; then
  case $base in https://github.com/qxchuckle/lattice/releases/latest/download) base="https://github.com/qxchuckle/lattice/releases/download/v$version";; esac
fi
archive="lattice-$version-$platform-$arch.tar.gz"
fetch SHA256SUMS "$stage/SHA256SUMS"
expected=$(awk -v name="$archive" '$2==name {print $1}' "$stage/SHA256SUMS")
[ "${#expected}" -eq 64 ] || fail "missing or invalid archive checksum"
case $expected in *[!0-9a-f]*) fail "invalid checksum";; esac
fetch "$archive" "$stage/archive.tar.gz"
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$stage/archive.tar.gz" | awk '{print $1}')
else actual=$(shasum -a 256 "$stage/archive.tar.gz" | awk '{print $1}'); fi
[ "$actual" = "$expected" ] || fail "archive SHA-256 mismatch"
# Protect both aliases before installing either, including directories and dangling links.
for name in ltc lattice; do
  command_path="$bin/$name"
  if [ -e "$command_path" ] || [ -L "$command_path" ]; then
    [ -L "$command_path" ] && [ "$(readlink "$command_path")" = "$prefix/current/bin/$name" ] || fail "preserving existing command: $command_path"
  fi
done
tar -xzf "$stage/archive.tar.gz" -C "$stage"
verify_payload() {
  (unset NODE_OPTIONS NODE_PATH; "$stage/payload/runtime/node" "$stage/payload/scripts/payload.cjs" "$version" "$1") || return 1
  [ "$("$1/bin/ltc" --version)" = "$version" ]
}
verify_payload "$stage/payload" || fail "candidate runtime verification failed"
# Reuse only an intact identical payload. Repairs get a new immutable directory, so the
# active/previous payload is never removed while another process may still be using it.
destination="$prefix/versions/$version-$(printf '%s' "$expected" | cut -c1-16)"
reuse=
reuse_existing() {
  [ ! -L "$1" ] && cmp -s "$stage/payload/manifest.json" "$1/manifest.json" && verify_payload "$1" >/dev/null 2>&1
}
current_target=
if [ -L "$prefix/current" ]; then current_target=$(readlink "$prefix/current"); fi
case $current_target in
  "$destination"|"$destination"-repair-*)
    if reuse_existing "$current_target"; then destination=$current_target; reuse=1; fi ;;
esac
if [ -z "$reuse" ]; then
  if [ -L "$destination" ]; then fail "preserving foreign version link: $destination"; fi
  if [ -e "$destination" ]; then
    if reuse_existing "$destination"; then reuse=1
    else
      echo "Repairing damaged Lattice payload" >&2
      repair_token=${stage##*.install-}
      destination="$destination-repair-$repair_token"
    fi
  fi
fi
# Keep the lock owner's PID through the final writes. A killed installer cannot leave an
# orphaned mv process that could replace a later installer's current pointer.
unset NODE_OPTIONS NODE_PATH
exec "$stage/payload/runtime/node" - "$stage" "$destination" "$reuse" "$prefix" "$bin" "$version" "$prefix_lock" "$bin_lock" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [stage, destination, reuse, prefix, bin, version, prefixLock, binLock] = process.argv.slice(2);
try {
  if (!reuse) fs.renameSync(path.join(stage, 'payload'), destination);
  for (const name of ['ltc', 'lattice']) {
    const alias = path.join(bin, name);
    const target = path.join(prefix, 'current', 'bin', name);
    try {
      if (fs.readlinkSync(alias) !== target) throw new Error('Preserving existing command: ' + alias);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      fs.symlinkSync(target, alias);
    }
  }
  const next = path.join(stage, 'current');
  fs.symlinkSync(destination, next);
  fs.renameSync(next, path.join(prefix, 'current'));
  console.log('Installed Lattice ' + version + ': ' + path.join(bin, 'ltc'));
} finally {
  for (const entry of [stage, prefixLock, binLock]) {
    try {
      if (entry === stage) fs.rmSync(entry, { recursive: true, force: true });
      else fs.rmdirSync(entry);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Lattice: could not clean up ' + entry + ': ' + error.message);
    }
  }
}
NODE
