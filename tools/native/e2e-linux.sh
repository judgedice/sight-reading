#!/usr/bin/env bash
# Native end-to-end test on Linux: the real UI of the debug app in the Tauri window (tauri-driver + WebKitWebDriver under
# xvfb), the real TypeScript backend over the real Rust commands, on the fake duplex audio device. See e2e-linux.mjs.
# Two app starts, each with a fresh profile: the full run at the default loop delay (23.4 ms), and onboarding with
# calibration at 41.7 ms. Screenshots and JSON results go to tools/native/artifacts/e2e/.
# Needs: xvfb, webkit2gtk-driver (WebKitWebDriver), `cargo install tauri-driver --locked`, the debug binary
# (`pnpm tauri build --debug --no-bundle`). Exits non-zero on failure.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$ROOT/src-tauri/target/debug/sightread"
OUT="$ROOT/tools/native/artifacts/e2e"
rm -rf "$OUT"
mkdir -p "$OUT"

for tool in xvfb-run tauri-driver WebKitWebDriver node pnpm; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 2; }
done
if [ ! -x "$BIN" ]; then
  echo "building debug binary"
  (cd "$ROOT" && pnpm tauri build --debug --no-bundle)
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sr-e2e.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# The fake device and the end-to-end hooks are opt-in by these variables; a build started without them has neither.
export SR_AUDIO_DEVICE=fake
export SR_E2E_HOOKS=1
export SR_E2E_SEED="${SR_E2E_SEED:-5}"
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}" no_proxy="127.0.0.1,localhost${no_proxy:+,$no_proxy}"

run() { # scenario loop-ms
  local scenario="$1" loop="$2" dir="$WORK/$1"
  mkdir -p "$dir/data" "$dir/cache" "$dir/config" "$dir/files"
  echo "== e2e scenario $scenario (loop delay $loop ms)"
  # A fresh profile per start: WebKit and the app keep their storage under XDG_DATA_HOME.
  XDG_DATA_HOME="$dir/data" XDG_CACHE_HOME="$dir/cache" XDG_CONFIG_HOME="$dir/config" SR_FAKE_LOOP_MS="$loop" \
    timeout 600 xvfb-run -a --server-args="-screen 0 1280x900x24" bash -c '
      tauri-driver >"$0/tauri-driver-$4.log" 2>&1 &
      DRIVER=$!
      trap "kill $DRIVER 2>/dev/null || true" EXIT
      node "$1/tools/native/e2e-linux.mjs" "$2" "$0" "$3" "$4" "$5"
    ' "$OUT" "$ROOT" "$BIN" "$dir/files" "$scenario" "$loop"
}

status=0
run main 23.4 || status=1
run timing 41.7 || status=1
if [ "$status" -ne 0 ]; then echo "e2e-linux: FAIL (see $OUT)" >&2; exit 1; fi
echo "e2e-linux: PASS ($OUT)"
