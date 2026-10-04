#!/usr/bin/env bash
# Build libcrispasr with the s4s patches (crisp-*.patch), in a copy of the source tree.
# Env: CRISPASR_SRC (git checkout or URL, default ~/tmp/stt), CRISPASR_DIR (build copy,
# default ~/tmp/crispasr-s4s), CRISPASR_REF (commit to build, default the pinned upstream
# commit the patches are made against), JOBS (default 2).
set -euo pipefail

SRC="${CRISPASR_SRC:-$HOME/tmp/stt}"
DIR="${CRISPASR_DIR:-$HOME/tmp/crispasr-s4s}"
# Upstream CrispStrobe/CrispASR 5b63ffeda (2026-07-25). Upstream history was rewritten so it is on
# no branch any more; a fresh URL clone fetches it by full sha, which GitHub still serves.
REF="${CRISPASR_REF:-5b63ffedae3b5ab306b55d25580a59a76e34b6d7}"
JOBS="${JOBS:-2}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PATCHES=("$HERE/crisp-audio-filtered-load.patch" "$HERE/crisp-vad-load-error.patch")

if [ ! -d "$DIR/.git" ]; then
  git clone --local "$SRC" "$DIR"
  if ! git -C "$DIR" cat-file -e "$REF^{commit}" 2>/dev/null; then
    git -C "$DIR" fetch --quiet origin "$REF"
  fi
  git -C "$DIR" -c advice.detachedHead=false checkout --quiet "$REF"
  git -C "$DIR" submodule init
  # Submodules come from the source checkout when it is local (no network), else from their URLs.
  for sm in ggml third_party/c2pa-audio; do
    if [ -e "$SRC/$sm/.git" ]; then git -C "$DIR" config "submodule.$sm.url" "$SRC/$sm"; fi
  done
  git -C "$DIR" -c protocol.file.allow=always submodule update --init --recursive
fi

for patch in "${PATCHES[@]}"; do
  if git -C "$DIR" apply --reverse --check "$patch" 2>/dev/null; then
    echo "already present in $DIR: $(basename "$patch")"
  else
    git -C "$DIR" apply "$patch"
    echo "applied to $DIR: $(basename "$patch")"
  fi
done

cmake -S "$DIR" -B "$DIR/build" -DCMAKE_BUILD_TYPE=Release \
  -DCRISPASR_BUILD_EXAMPLES=OFF -DCRISPASR_BUILD_TESTS=OFF -DCRISPASR_BUILD_SERVER=OFF
cmake --build "$DIR/build" --target crispasr-lib -j "$JOBS"

LIB="$DIR/build/src/libcrispasr.dylib"
if [ ! -e "$LIB" ]; then LIB="$DIR/build/src/libcrispasr.so"; fi
echo "built: $LIB"
echo "set in .env: CRISPASR_LIB=$LIB"
