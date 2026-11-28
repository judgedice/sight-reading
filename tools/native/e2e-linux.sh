#!/usr/bin/env bash
# Native end-to-end test on Linux: the real UI of the debug app in the Tauri window (tauri-driver + WebKitWebDriver under
# xvfb), the real TypeScript backend over the real Rust commands, on the fake duplex audio device. See e2e-linux.mjs.
# Three scenarios, each with a fresh profile: the full run at the default loop delay (23.4 ms), onboarding with
# calibration at 41.7 ms, and `data` (storage across relaunches, backup export through the native save command with
# SR_E2E_SAVE_DIR, delete all, import, links, keep-awake; four app starts on one profile). Screenshots and JSON results go to tools/native/artifacts/e2e/.
# Needs: xvfb, webkit2gtk-driver (WebKitWebDriver), `cargo install tauri-driver --locked`, the debug binary
# (`pnpm tauri build --debug --no-bundle`). Exits non-zero on failure.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$ROOT/src-tauri/target/debug/sightread"
# Two runs at once (two checkouts or agents) need different ports and output directories: SR_E2E_PORT and SR_E2E_OUT.
OUT="${SR_E2E_OUT:-$ROOT/tools/native/artifacts/e2e}"
PORT="${SR_E2E_PORT:-4444}"
export SR_E2E_PORT="$PORT"
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
  # SR_E2E_SAVE_DIR (with SR_E2E_HOOKS=1, exported above) makes the save command write there without a dialog.
  XDG_DATA_HOME="$dir/data" XDG_CACHE_HOME="$dir/cache" XDG_CONFIG_HOME="$dir/config" SR_FAKE_LOOP_MS="$loop" SR_E2E_SAVE_DIR="$dir/saved" \
    timeout 600 xvfb-run -a --server-args="-screen 0 1280x900x24" bash -c '
      tauri-driver --port "$6" --native-port "$((${6} + 1))" >"$0/tauri-driver-$4.log" 2>&1 &
      DRIVER=$!
      trap "kill $DRIVER 2>/dev/null || true" EXIT
      node "$1/tools/native/e2e-linux.mjs" "$2" "$0" "$3" "$4" "$5"
    ' "$OUT" "$ROOT" "$BIN" "$dir/files" "$scenario" "$loop" "$PORT"
}

# `e2e-linux.sh data` runs one scenario; without an argument all three run.
only="${1:-}"
status=0
if [ -z "$only" ] || [ "$only" = main ]; then run main 23.4 || status=1; fi
if [ -z "$only" ] || [ "$only" = timing ]; then run timing 41.7 || status=1; fi
if [ -z "$only" ] || [ "$only" = data ]; then run data 23.4 || status=1; fi
if [ "$status" -ne 0 ]; then echo "e2e-linux: FAIL (see $OUT)" >&2; exit 1; fi
echo "e2e-linux: PASS ($OUT)"
