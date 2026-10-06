#!/bin/sh
# Install or upgrade st4s into $ST4S_HOME (default ~/.st4s). No sudo needed.
#   sh install.sh [path/to/st4s-<version>-<os>-<arch>.tar.gz]
# Without an argument the latest GitHub Release of $ST4S_REPO is downloaded and its .sha256 verified;
# a local tarball is verified when <tarball>.sha256 sits next to it.
# Only the items in ITEMS are replaced; .env, models/ and logs/ are never touched (upgrade-safe).
set -eu

REPO="${ST4S_REPO:-bipprojectbali/st4s}"
DEST="${ST4S_HOME:-$HOME/.st4s}"
ITEMS="st4s lib LICENSES README.txt BUILD_INFO"

die() {
  echo "st4s install: error: $*" >&2
  exit 1
}
warn() { echo "st4s install: warning: $*" >&2; }

host_platform() {
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "unsupported OS: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=x64 ;;
    *) die "unsupported CPU: $(uname -m)" ;;
  esac
  echo "$os-$arch"
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    die "need shasum or sha256sum to verify $1"
  fi
}

verify_sha256() {
  want=$(head -n1 "$2" | cut -d' ' -f1)
  got=$(sha256_of "$1")
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    die "sha256 mismatch for $1 (expected ${want:-<empty>}, got ${got:-<none>}); not installing"
  fi
  echo "sha256 ok: $got"
}

# Prints the downloaded tarball path; curl downloads carry no quarantine flag.
download_latest() {
  command -v curl >/dev/null 2>&1 || die "curl is required to download a release (or pass a tarball path)"
  api="https://api.github.com/repos/$REPO/releases/latest"
  tag=$(curl -fsSL "$api" | sed -n 's/^ *"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)
  [ -n "$tag" ] || die "no latest release found at $api (set ST4S_REPO or pass a tarball path)"
  name="st4s-${tag#v}-$2.tar.gz"
  url="https://github.com/$REPO/releases/download/$tag/$name"
  echo "downloading $url" >&2
  curl -fSL --proto '=https' -o "$1/$name" "$url" || die "download failed: $url"
  curl -fsSL --proto '=https' -o "$1/$name.sha256" "$url.sha256" || die "download failed: $url.sha256"
  echo "$1/$name"
}

[ $# -le 1 ] || die "usage: sh install.sh [path/to/st4s-<version>-<os>-<arch>.tar.gz]"
PLATFORM=$(host_platform)
mkdir -p "$DEST"
# Staging lives inside $DEST so every swap below is a same-filesystem rename.
STAGE=$(mktemp -d "$DEST/.install.XXXXXX")
mkdir "$STAGE/new" "$STAGE/old"
SWAPPED=""
DONE=0

# On failure put the previous items back; keep STAGE if that fails so nothing is lost.
cleanup() {
  status=$?
  if [ "$DONE" != 1 ] && [ -n "$SWAPPED" ]; then
    for n in $SWAPPED; do
      rm -rf "${DEST:?}/$n" || echo "st4s install: could not remove new $DEST/$n" >&2
      if [ -e "$STAGE/old/$n" ] && ! mv "$STAGE/old/$n" "$DEST/$n"; then
        echo "st4s install: rollback failed; previous files kept in $STAGE/old" >&2
        exit "$status"
      fi
    done
    echo "st4s install: rolled back to the previous install" >&2
  fi
  rm -rf "$STAGE"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if [ $# -eq 1 ]; then
  TARBALL=$1
  [ -f "$TARBALL" ] || die "tarball not found: $TARBALL"
  if [ -f "$TARBALL.sha256" ]; then
    verify_sha256 "$TARBALL" "$TARBALL.sha256"
  else
    warn "no $TARBALL.sha256 next to the tarball; checksum not verified"
  fi
else
  TARBALL=$(download_latest "$STAGE" "$PLATFORM")
  verify_sha256 "$TARBALL" "$TARBALL.sha256"
fi

tar -xzf "$TARBALL" -C "$STAGE/new" || die "cannot extract $TARBALL"
NEW="$STAGE/new/st4s"
if [ ! -f "$NEW/st4s" ] || [ ! -f "$NEW/BUILD_INFO" ]; then
  die "$TARBALL is not an st4s release (missing st4s/st4s or st4s/BUILD_INFO)"
fi
TARGET=$(sed -n 's/^platform=//p' "$NEW/BUILD_INFO")
VERSION=$(sed -n 's/^version=//p' "$NEW/BUILD_INFO")
[ "$TARGET" = "$PLATFORM" ] || die "tarball is for ${TARGET:-an unknown platform}, this machine is $PLATFORM"
UPGRADE=0
[ -e "$DEST/st4s" ] && UPGRADE=1

for n in $ITEMS; do
  SWAPPED="$SWAPPED $n"
  if [ -e "$DEST/$n" ] || [ -L "$DEST/$n" ]; then mv "$DEST/$n" "$STAGE/old/$n"; fi
  if [ -e "$NEW/$n" ]; then mv "$NEW/$n" "$DEST/$n"; fi
done
chmod 755 "$DEST/st4s"
DONE=1
# The built-in Postgres runtime (~60 MB download) lives in lib/pg; carry it over instead of re-downloading.
if [ -d "$STAGE/old/lib/pg" ] && [ ! -e "$DEST/lib/pg" ]; then
  mkdir -p "$DEST/lib" && mv "$STAGE/old/lib/pg" "$DEST/lib/pg"
fi

if [ "$(uname -s)" = Darwin ]; then
  if command -v xattr >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$DEST" || die "could not clear the quarantine flag; run: xattr -dr com.apple.quarantine $DEST"
  else
    warn "xattr not found; if macOS blocks st4s, run: xattr -dr com.apple.quarantine $DEST"
  fi
fi

FF="${FFMPEG_PATH:-ffmpeg}"
if ! command -v "$FF" >/dev/null 2>&1; then
  warn "ffmpeg not found ($FF); audio endpoints need it. Install it (macOS: brew install ffmpeg) or set FFMPEG_PATH in $DEST/.env"
fi

echo "st4s ${VERSION:-?} ($PLATFORM) installed in $DEST"
if [ "$UPGRADE" = 1 ] && [ -f "$DEST/.env" ]; then
  cat <<EOF
Upgrade done (.env, models/, logs/, pg/ and lib/pg kept). Next:
  $DEST/st4s migrate   # apply new database migrations, if any
  $DEST/st4s doctor    # check lib/, models, ffmpeg, .env
  $DEST/st4s           # start the server
EOF
else
  cat <<EOF
Next steps:
  $DEST/st4s init          # create $DEST/.env, set up the database, run migrations
  $DEST/st4s models pull   # download models (offline: $DEST/st4s models import <dir>)
  $DEST/st4s doctor        # check lib/, models, ffmpeg, .env, migrations
  $DEST/st4s               # start the server
EOF
fi
