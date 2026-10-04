#!/usr/bin/env bash
# Build libcrispasr with the filtered audio-tower load patch, in a copy of the source tree.
# Env: CRISPASR_SRC (git checkout or URL, default ~/tmp/stt), CRISPASR_DIR (build copy,
# default ~/tmp/crispasr-s4s), CRISPASR_REF (commit to build, default source HEAD), JOBS (default 2).
set -euo pipefail

SRC="${CRISPASR_SRC:-$HOME/tmp/stt}"
DIR="${CRISPASR_DIR:-$HOME/tmp/crispasr-s4s}"
JOBS="${JOBS:-2}"
PATCH="$(cd "$(dirname "$0")" && pwd)/crisp-audio-filtered-load.patch"

if [ ! -d "$DIR/.git" ]; then
  git clone --local "$SRC" "$DIR"
  if [ -n "${CRISPASR_REF:-}" ]; then git -C "$DIR" checkout --quiet "$CRISPASR_REF"; fi
  git -C "$DIR" submodule init
  # Submodules come from the source checkout when it is local (no network), else from their URLs.
  for sm in ggml third_party/c2pa-audio; do
    if [ -e "$SRC/$sm/.git" ]; then git -C "$DIR" config "submodule.$sm.url" "$SRC/$sm"; fi
  done
  git -C "$DIR" -c protocol.file.allow=always submodule update --init --recursive
fi

if git -C "$DIR" apply --reverse --check "$PATCH" 2>/dev/null; then
  echo "patch already present in $DIR"
else
  git -C "$DIR" apply "$PATCH"
  echo "patch applied to $DIR"
fi

cmake -S "$DIR" -B "$DIR/build" -DCMAKE_BUILD_TYPE=Release \
  -DCRISPASR_BUILD_EXAMPLES=OFF -DCRISPASR_BUILD_TESTS=OFF -DCRISPASR_BUILD_SERVER=OFF
cmake --build "$DIR/build" --target crispasr-lib -j "$JOBS"

LIB="$DIR/build/src/libcrispasr.dylib"
if [ ! -e "$LIB" ]; then LIB="$DIR/build/src/libcrispasr.so"; fi
echo "built: $LIB"
echo "set in .env: CRISPASR_LIB=$LIB"
