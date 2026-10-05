#!/usr/bin/env bash
# Build the st4s release bundle for this host:
#   dist/st4s/ (st4s binary, lib/, LICENSES/, README.txt, BUILD_INFO)
#   -> dist/st4s-<version>-<os>-<arch>.tar.gz + .sha256, plus dist/install.sh for the release page.
# Usage: bash scripts/release/package.sh   (needs .crispasr/build from scripts/crispasr/build.sh)
# Env: CRISPASR_DIR (default <repo>/.crispasr), CRISPASR_BUILD_DIR (default $CRISPASR_DIR/build). Network: fetches the onnxruntime license files.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
CRISPASR_DIR="${CRISPASR_DIR:-$ROOT/.crispasr}"
CRISPASR_BUILD_DIR="${CRISPASR_BUILD_DIR:-$CRISPASR_DIR/build}"
LOCK=/tmp/s4s-build.lock
MIN_FREE_PCT=25

# ponytail: host builds only; linux-x64 needs its own case (libonnxruntime.so.1, libcrispasr built on Linux).
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)
    PLATFORM=darwin-arm64
    ORT_LIB=node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/libonnxruntime.1.dylib
    ;;
  *) echo "error: packaging on $(uname -s)-$(uname -m) is not supported yet (darwin-arm64 only)" >&2; exit 1 ;;
esac

VERSION="$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"
ORT_VERSION="$(bun -e 'console.log((await Bun.file("node_modules/onnxruntime-node/package.json").json()).version)')"
[ -f "$ORT_LIB" ] || { echo "error: $ORT_LIB missing (run: bun install)" >&2; exit 1; }
for f in "$CRISPASR_DIR/LICENSE" "$CRISPASR_DIR/ggml/LICENSE"; do
  [ -f "$f" ] || { echo "error: $f missing (run: bash scripts/crispasr/build.sh)" >&2; exit 1; }
done

echo "== build st4s $VERSION ($PLATFORM)"
until mkdir "$LOCK" 2>/dev/null; do echo "waiting for build lock $LOCK" >&2; sleep 5; done
trap 'rmdir "$LOCK"' EXIT
free_pct="$(memory_pressure | tail -1 | grep -Eo '[0-9]+' | tail -1)"
if [ "${free_pct:-0}" -lt "$MIN_FREE_PCT" ]; then
  echo "error: free RAM ${free_pct:-?}% < ${MIN_FREE_PCT}%; retry when memory is available" >&2
  exit 1
fi
bun run build:binary
rmdir "$LOCK"
trap - EXIT

DIST="$ROOT/dist"
OUT="$DIST/st4s"
TARBALL="st4s-$VERSION-$PLATFORM.tar.gz"
echo "== stage $OUT"
rm -rf "${OUT:?}" "${DIST:?}/$TARBALL" "$DIST/$TARBALL.sha256"
mkdir -p "$OUT/lib" "$OUT/LICENSES"
cp st4s "$OUT/st4s"
bash scripts/crispasr/bundle-lib.sh "$OUT/lib" "$CRISPASR_BUILD_DIR"
cp "$ORT_LIB" "$OUT/lib/libonnxruntime.1.dylib"

for f in "$OUT/st4s" "$OUT"/lib/*; do
  if ! codesign --verify "$f" 2>/dev/null; then
    echo "re-signing (ad-hoc) $(basename "$f")"
    codesign -f -s - "$f"
  fi
done

cp LICENSE "$OUT/LICENSES/st4s.txt"
cp "$CRISPASR_DIR/LICENSE" "$OUT/LICENSES/crispasr.txt"
cp "$CRISPASR_DIR/ggml/LICENSE" "$OUT/LICENSES/ggml.txt"
ORT_RAW="https://raw.githubusercontent.com/microsoft/onnxruntime/v$ORT_VERSION"
curl -fsSL --proto '=https' -o "$OUT/LICENSES/onnxruntime.txt" "$ORT_RAW/LICENSE"
curl -fsSL --proto '=https' -o "$OUT/LICENSES/onnxruntime-ThirdPartyNotices.txt" "$ORT_RAW/ThirdPartyNotices.txt"

printf 'version=%s\nplatform=%s\n' "$VERSION" "$PLATFORM" >"$OUT/BUILD_INFO"
cat >"$OUT/README.txt" <<EOF
st4s $VERSION ($PLATFORM)

Install / upgrade (keeps .env, models/ and logs/):
  sh install.sh st4s-$VERSION-$PLATFORM.tar.gz      # into \$ST4S_HOME, default ~/.st4s

Then:
  ~/.st4s/st4s init          # create ~/.st4s/.env (set DATABASE_URL), run migrations
  ~/.st4s/st4s models pull   # or: ~/.st4s/st4s models import <dir>
  ~/.st4s/st4s doctor        # check lib/, models, ffmpeg, .env, migrations
  ~/.st4s/st4s               # start the server

Layout: st4s (binary), lib/ (libcrispasr, libggml*, libonnxruntime), models/, .env, logs/.
ffmpeg is not bundled: install it on PATH or set FFMPEG_PATH.
Not notarized: if macOS blocks it, run  xattr -dr com.apple.quarantine ~/.st4s
Third-party licenses: LICENSES/.
EOF

echo "== pack $DIST/$TARBALL"
COPYFILE_DISABLE=1 tar --no-mac-metadata -C "$DIST" -czf "$DIST/$TARBALL" st4s
(cd "$DIST" && shasum -a 256 "$TARBALL" >"$TARBALL.sha256")
cp scripts/install.sh "$DIST/install.sh"
tar -tzvf "$DIST/$TARBALL"
ls -lh "$DIST/$TARBALL" "$DIST/$TARBALL.sha256" "$DIST/install.sh"
cat "$DIST/$TARBALL.sha256"
