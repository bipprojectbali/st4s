#!/usr/bin/env bash
# Build libcrispasr at the pinned upstream release plus the s4s patch, in its own source copy.
# Env: CRISPASR_SRC (git checkout or URL to clone, default upstream GitHub; a local checkout such
# as ~/tmp/stt skips most of the download), CRISPASR_DIR (build copy, default <repo>/.crispasr,
# gitignored, whose lib STT loads by default), CRISPASR_TAG + CRISPASR_REF (release tag and the commit it must
# resolve to), JOBS (default 2).
set -euo pipefail

UPSTREAM="https://github.com/CrispStrobe/CrispASR"
SRC="${CRISPASR_SRC:-$UPSTREAM}"
# Release v0.8.41 (2026-10-02), an ancestor of upstream main. It already contains the filtered
# audio-tower load (e144dd03) and -3 for an unloadable VAD model (6b699c8df, 188e21c1a).
# It also adds VAD failover (a0ff88816): a >=120 s clip with (almost) no speech is decoded in full
# and Qwen3-ASR hallucinates on it; run the STT child with CRISPASR_VAD_FAILOVER=0 to keep "" there.
TAG="${CRISPASR_TAG:-v0.8.41}"
REF="${CRISPASR_REF:-340d7085eaa53c40a46dcb73a6d3d0448a480006}"
JOBS="${JOBS:-2}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DIR="${CRISPASR_DIR:-$ROOT/.crispasr}"
PATCHES=("$HERE/crisp-vad-inference-error.patch")

if [ ! -d "$DIR/.git" ]; then
  if [ -d "$SRC" ]; then git clone --local "$SRC" "$DIR"; else git clone "$SRC" "$DIR"; fi
  # A local checkout may predate the release; take the tag from upstream then.
  if ! git -C "$DIR" cat-file -e "$REF^{commit}" 2>/dev/null; then
    git -C "$DIR" fetch --quiet "$UPSTREAM" "refs/tags/$TAG:refs/tags/$TAG"
  fi
  git -C "$DIR" -c advice.detachedHead=false checkout --quiet "$REF"
  git -C "$DIR" submodule init
  # Submodules come from the local source checkout when it has the pinned commit, else from their URLs.
  for sm in ggml third_party/c2pa-audio; do
    want="$(git -C "$DIR" ls-tree HEAD "$sm" | awk '{print $3}')"
    if [ -e "$SRC/$sm/.git" ] && git -C "$SRC/$sm" cat-file -e "$want^{commit}" 2>/dev/null; then
      git -C "$DIR" config "submodule.$sm.url" "$SRC/$sm"
    fi
  done
  git -C "$DIR" -c protocol.file.allow=always submodule update --init --recursive
fi

# An existing copy at another commit would get patched and built as if it were the pin.
HEAD_SHA="$(git -C "$DIR" rev-parse HEAD)"
if [ "$HEAD_SHA" != "$REF" ]; then
  echo "error: $DIR is at $HEAD_SHA, not $TAG ($REF); set a new CRISPASR_DIR" >&2
  exit 1
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
if [ "$DIR" != "$ROOT/.crispasr" ]; then echo "set in .env: CRISPASR_LIB=$LIB"; fi
