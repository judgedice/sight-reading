#!/usr/bin/env bash
# Linux native smoke test: runs the debug binary under xvfb through tauri-driver + WebKitWebDriver, checks that the
# first screen rendered and IPC works, and saves a screenshot to tools/native/artifacts/smoke-linux.png.
# Needs: xvfb, webkit2gtk-driver (WebKitWebDriver), `cargo install tauri-driver --locked`. Exits non-zero on failure.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$ROOT/src-tauri/target/debug/sightread"
OUT="$ROOT/tools/native/artifacts"
mkdir -p "$OUT"
rm -f "$OUT/smoke-linux.png"

for tool in xvfb-run tauri-driver WebKitWebDriver node; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 2; }
done
if [ ! -x "$BIN" ]; then
  echo "building debug binary"
  (cd "$ROOT" && pnpm tauri build --debug --no-bundle)
fi

# Worklet asset (relative to the app origin) so the probe can test AudioWorklet module loading.
WORKLET="$(cd "$ROOT/dist" && ls assets/capture.worklet*.js 2>/dev/null | head -n1 || true)"

DSPW="$(cd "$ROOT/dist" && ls assets/dsp.worker*.js 2>/dev/null | head -n1 || true)"

export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}" no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}"

timeout 180 xvfb-run -a --server-args="-screen 0 1280x900x24" bash -c '
  tauri-driver >"$0/tauri-driver.log" 2>&1 &
  DRIVER=$!
  trap "kill $DRIVER 2>/dev/null || true" EXIT
  node "$1/tools/native/smoke-linux.mjs" "$2" "$0/smoke-linux.png" "$3" "$4"
' "$OUT" "$ROOT" "$BIN" "$WORKLET" "$DSPW"

[ -s "$OUT/smoke-linux.png" ] || { echo "no screenshot produced" >&2; exit 1; }
echo "smoke-linux: PASS ($OUT/smoke-linux.png)"
