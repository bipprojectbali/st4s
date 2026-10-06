#!/usr/bin/env bash
# Copy libcrispasr + its libggml* into one directory that loads from anywhere (@loader_path / $ORIGIN),
# then self-check: no absolute non-system dependency and a bun:ffi dlopen from cwd=/ succeeds.
# Needs a lib built by build.sh (AMR/Opus off, so no Homebrew deps). Linux branch is untested.
set -euo pipefail

usage() {
  echo "usage: $0 <out_lib_dir> [build_dir]" >&2
  echo "  build_dir: cmake build dir of scripts/crispasr/build.sh (default <repo>/.crispasr/build-reloc, the release build)" >&2
  exit 2
}
[ $# -ge 1 ] && [ $# -le 2 ] || usage
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="${2:-$ROOT/.crispasr/build-reloc}"
[ -d "$BUILD" ] || { echo "error: build dir not found: $BUILD (run: CRISPASR_BUILD_DIR=\"$BUILD\" bash scripts/crispasr/build.sh)" >&2; exit 1; }
mkdir -p "$1"
OUT="$(cd "$1" && pwd -P)"

if [ "$(uname)" = Darwin ]; then
  MAIN=libcrispasr.dylib
  NAMES=(libcrispasr.dylib libggml.0.dylib libggml-base.0.dylib libggml-cpu.0.dylib libggml-blas.0.dylib libggml-metal.0.dylib)
else
  MAIN=libcrispasr.so
  NAMES=(libcrispasr.so libggml.so.0 libggml-base.so.0 libggml-cpu.so.0 libggml-blas.so.0)
fi

# blas/metal are optional per platform; a missing lib that libcrispasr links fails the dlopen below.
# Only the copied files are rewritten: the dir may also hold other libs (libonnxruntime).
COPIED=()
for name in "${NAMES[@]}"; do
  src="$(find "$BUILD" -name "$name" -not -path '*/CMakeFiles/*' | head -n 1)"
  if [ -z "$src" ]; then
    case "$name" in libcrispasr.*|libggml.*|libggml-base.*|libggml-cpu.*)
      echo "error: $name not found under $BUILD" >&2; exit 1;;
    esac
    continue
  fi
  rm -f "$OUT/$name"
  cp -L "$src" "$OUT/$name"
  chmod u+w "$OUT/$name"
  COPIED+=("$OUT/$name")
  echo "copied: $name <- $src"
done

# Run quietly (install_name_tool/codesign chatter), but show the output when the command fails.
quiet() { local out; if ! out="$("$@" 2>&1)"; then echo "$out" >&2; return 1; fi; }

if [ "$(uname)" = Darwin ]; then
  for f in "${COPIED[@]}"; do
    xattr -c "$f"
    otool -l "$f" | awk '/cmd LC_RPATH/ { getline; getline; print $2 }' | while read -r rp; do
      quiet install_name_tool -delete_rpath "$rp" "$f"
    done
    quiet install_name_tool -add_rpath @loader_path -id "@rpath/$(basename "$f")" "$f"
    quiet codesign -f -s - "$f"
  done
  fail=0
  for f in "${COPIED[@]}"; do
    bad="$(otool -L "$f" | tail -n +2 | awk '{print $1}' | grep '^/' | grep -Ev '^/(usr/lib|System)/' | tr '\n' ' ' || true)"
    if [ -n "$bad" ]; then
      echo "error: $(basename "$f") links absolute non-system path: $bad(rebuild with scripts/crispasr/build.sh: AMR/Opus off)" >&2
      fail=1
    fi
    rps="$(otool -l "$f" | awk '/cmd LC_RPATH/ { getline; getline; print $2 }' | tr '\n' ' ')"
    if [ "$rps" != "@loader_path " ]; then echo "error: $(basename "$f") LC_RPATH is '$rps', want '@loader_path'" >&2; fail=1; fi
  done
else
  if command -v patchelf >/dev/null; then
    for f in "${COPIED[@]}"; do patchelf --set-rpath '$ORIGIN' "$f"; done
  fi
  fail=0
  for f in "${COPIED[@]}"; do
    rp="$(readelf -d "$f" | awk '/RUNPATH|RPATH/ { print $NF }' | tr -d '[]')"
    if [ "$rp" != '$ORIGIN' ]; then echo "error: $(basename "$f") RUNPATH is '$rp', want '\$ORIGIN' (install patchelf)" >&2; fail=1; fi
  done
fi
[ "$fail" = 0 ] || exit 1
echo "check: no absolute non-system deps, rpath = loader dir only"

command -v bun >/dev/null || { echo "error: bun not on PATH, cannot run the dlopen self-check" >&2; exit 1; }
(cd / && ST4S_BUNDLE_LIB="$OUT/$MAIN" bun -e '
import { dlopen, FFIType } from "bun:ffi";
const lib = dlopen(process.env.ST4S_BUNDLE_LIB, { crispasr_session_close: { args: [FFIType.ptr], returns: FFIType.void } });
lib.close();
console.log(`check: dlopen ok from cwd=/ (${process.env.ST4S_BUNDLE_LIB})`);
')
du -sh "$OUT" | awk '{ print "bundled: " $2 " (" $1 ")" }'
