#!/usr/bin/env bash
# Build MAME for the browser (WebAssembly + pthreads + SIMD, bgfx on WebGL2) with W.D.D's driver set.
#
#   tools/mame/build.sh [--out DIR] [--jobs N] [--drivers FILE] [--source DIR]
#
# --source DIR: a MAME git checkout on this machine to start from instead of cloning (GitHub can be slow);
# it must have the pinned commit.
# --drivers builds another driver filter than drivers.txt (a quick check with one or two drivers),
# as version <version>-custom.
#
# On the host it builds the pinned builder image (Dockerfile) and runs itself inside it; inside the
# image (IN_MAME_BUILDER=1) it does the build. MAME's source is cached in the Docker volume
# wdd-mame-src, so a second build only recompiles what changed.
# Output (default tools/mame/dist/<version>/, gitignored): mame.js, mame.wasm, manifest.json,
# LICENSE.txt (MAME's GPL-2.0), SOURCE.md and recipe/ (this recipe, so the build can be redone).
# Lines starting "@@" are for W.D.D's server (server/mame/index.js), which runs this script for
# "Get MAME" and shows its progress: "@@phase <name>", "@@expect <objects>", "@@done <dir>".
set -euo pipefail

MAME_TAG=mame0289
MAME_COMMIT=f34f02505e32c1993c6a782b6814232cbfc74e36
MAME_REPO=https://github.com/mamedev/mame.git
RECIPE=2                                   # bump when drivers.txt, the patch or the flags change
VERSION="0.${MAME_TAG#mame0}-wdd.${RECIPE}" # 0.289-wdd.1: the folder name W.D.D serves it under
SUBTARGET=wdd
EXPECT_OBJECTS=2727                        # compile steps of a clean build, for progress (measured)
POOL=6                                     # Web Workers made before main() (MAME's threads + SDL's)
IMAGE="wdd-mame-builder:${VERSION}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT=""
JOBS=""
DRIVERS=""
SEED=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --jobs) JOBS="$2"; shift 2 ;;
    --drivers) DRIVERS="$2"; shift 2 ;;
    --source) SEED="$2"; shift 2 ;;
    --version) echo "$VERSION"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

# ───────────────────────────── on the host: run in Docker ─────────────────────────────
if [ -z "${IN_MAME_BUILDER:-}" ]; then
  command -v docker >/dev/null || { echo "Docker is needed (or run inside an emsdk 6.0.5 environment with IN_MAME_BUILDER=1)" >&2; exit 1; }
  OUT="${OUT:-$HERE/dist}"
  mkdir -p "$OUT"
  OUT="$(cd "$OUT" && pwd)"
  echo "@@phase image"
  docker build -q -t "$IMAGE" "$HERE" >/dev/null
  echo "@@phase source"
  exec docker run --rm \
    -v wdd-mame-src:/src \
    -v "$OUT":/out \
    -e EXTRA_LDOPTS="${EXTRA_LDOPTS:-}" -e POOL_SIZE="${POOL_SIZE:-}" \
    ${DRIVERS:+-v "$(cd "$(dirname "$DRIVERS")" && pwd)/$(basename "$DRIVERS")":/recipe/custom.txt:ro} \
    ${SEED:+-v "$(cd "$SEED" && pwd)":/seed:ro} \
    "$IMAGE" --out /out ${JOBS:+--jobs "$JOBS"} ${DRIVERS:+--drivers /recipe/custom.txt} ${SEED:+--source /seed}
fi

# ───────────────────────────── inside the builder ─────────────────────────────
OUT="${OUT:-/out}"
SRC=/src/mame
FILTER=/recipe/drivers.txt
if [ -n "$DRIVERS" ]; then FILTER="$DRIVERS"; SUBTARGET=wddcustom; VERSION="$VERSION-custom"; fi
POOL="${POOL_SIZE:-$POOL}"
START=$(date +%s)
if [ -z "$JOBS" ]; then
  # MAME's bigger files take 1–2 GB each to compile at -O3: one job per 1.5 GB, at most one per CPU
  mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  JOBS=$(( mem_kb / 1500000 )); [ "$JOBS" -lt 1 ] && JOBS=1
  [ "$JOBS" -gt "$(nproc)" ] && JOBS=$(nproc)
fi

echo "@@phase source"
if [ ! -d "$SRC/.git" ] && [ -n "$SEED" ]; then
  rm -rf "$SRC"; git clone -q "file://$SEED" "$SRC"
  git -C "$SRC" remote set-url origin "$MAME_REPO"
fi
if [ ! -d "$SRC/.git" ]; then
  rm -rf "$SRC"; git clone --depth 1 --branch "$MAME_TAG" "$MAME_REPO" "$SRC"
fi
git config --global --add safe.directory "$SRC"
cd "$SRC"
if [ "$(git rev-parse HEAD)" != "$MAME_COMMIT" ]; then
  git fetch --depth 1 origin "refs/tags/$MAME_TAG:refs/tags/$MAME_TAG"
  git checkout -q -f "$MAME_COMMIT"
fi
[ "$(git rev-parse HEAD)" = "$MAME_COMMIT" ] || { echo "MAME source is not $MAME_COMMIT" >&2; exit 1; }
# a clean tree each time (build/ is ignored by git, so unchanged objects are reused), then W.D.D's patch
git reset -q --hard
for p in /recipe/patches/*.patch; do git apply "$p"; done
cp "$FILTER" "src/mame/$SUBTARGET.flt"

echo "@@phase compile"
echo "@@expect $EXPECT_OBJECTS"
echo "building $VERSION ($MAME_TAG, emcc $(emcc --version | head -1 | awk '{print $NF}' | tr -d '()' | cut -c1-12)) with $JOBS jobs"
# -msimd128: WebAssembly SIMD; -pthread: threads (Web Workers + SharedArrayBuffer: the page must be
# cross-origin isolated). The worker pool is made before main() runs, as MAME starts its work queue
# threads before it hands the main loop to the browser.
emmake make -j"$JOBS" \
  SUBTARGET="$SUBTARGET" SOURCEFILTER="src/mame/$SUBTARGET.flt" \
  WEBASSEMBLY=1 OPTIMIZE=3 SYMBOLS=0 NOWERROR=1 REGENIE=1 \
  PYTHON_EXECUTABLE=python3 \
  ARCHOPTS="-msimd128 -pthread" \
  LDOPTS="-pthread -sPTHREAD_POOL_SIZE=$POOL -sPTHREAD_POOL_SIZE_STRICT=0 -sMAXIMUM_MEMORY=2GB ${EXTRA_LDOPTS:-}"

echo "@@phase package"
STAGE="$OUT/.stage-$VERSION"
rm -rf "$STAGE"; mkdir -p "$STAGE/recipe/patches"
cp "$SUBTARGET.wasm" "$STAGE/mame.wasm"
# the loader names its .wasm (and pthreads load the loader itself as their worker script)
sed "s/$SUBTARGET\.wasm/mame.wasm/g" "$SUBTARGET.js" > "$STAGE/mame.js"
cp COPYING "$STAGE/LICENSE.txt"
cp /recipe/build.sh /recipe/drivers.txt /recipe/manifest.mjs /recipe/systems.mjs /recipe/Dockerfile "$STAGE/recipe/"
cp /recipe/patches/*.patch "$STAGE/recipe/patches/"
# the systems the build has: MAME's generated driver list for this subtarget
DRIVLIST="build/generated/mame/$SUBTARGET/drivlist.cpp"
cat > "$STAGE/SOURCE.md" <<EOF
# MAME $VERSION for W.D.D

MAME is free software under the GNU General Public License, version 2 (LICENSE.txt); copyright the
MAME team and contributors. This is MAME built for web browsers, unmodified except for the patch in
recipe/patches/ (lets MAME use threads when built with Emscripten pthreads, exports Emscripten's FS).

- Source: $MAME_REPO, tag $MAME_TAG, commit $MAME_COMMIT
  (https://github.com/mamedev/mame/tree/$MAME_COMMIT)
- Built with Emscripten $(emcc --version | head -1 | sed 's/.*) //') in the image from recipe/Dockerfile
- Recipe: recipe/build.sh, the driver selection recipe/drivers.txt

No ROMs or other copyrighted game data are part of this build.
EOF
# parents, BIOS sets and device ROM sets, from MAME itself (-listxml under Node)
# (from a copy inside the container: the output folder may be a slow bind mount)
rm -rf /tmp/list; mkdir -p /tmp/list; cp "$STAGE/mame.js" "$STAGE/mame.wasm" /tmp/list/
node /recipe/systems.mjs /tmp/list "$FILTER" > /tmp/systems.json || echo "systems.mjs failed: the manifest lists names only" >&2
node /recipe/manifest.mjs "$STAGE" \
  --version "$VERSION" --tag "$MAME_TAG" --commit "$MAME_COMMIT" \
  --emcc "$(emcc --version | head -1 | sed 's/.*) //; s/ .*//')" \
  --filter "$FILTER" --drivlist "$DRIVLIST" --systems /tmp/systems.json \
  --seconds "$(( $(date +%s) - START ))" --jobs "$JOBS"
rm -rf "$OUT/$VERSION"
mv "$STAGE" "$OUT/$VERSION"
echo "@@done $OUT/$VERSION"
