#!/usr/bin/env bash
# Opt-in: runs a command (default: the real cpal output test) against a PulseAudio null sink, so a machine without
# a sound card (a container, CI) can exercise the real cpal/ALSA output path. Linux only.
#
#   bash tools/native/audio-null-sink.sh                     # runs the cpal output test with SR_TEST_REAL_AUDIO=1
#   bash tools/native/audio-null-sink.sh <command> [args]    # runs <command> with the sink as the default device
#
# Needs: pulseaudio, pactl, and ALSA's pulse plugin (apt: pulseaudio pulseaudio-utils libasound2-plugins).
# It starts a private PulseAudio instance (own runtime dir, stopped again on exit) and points ALSA's default
# device at it through ALSA_CONFIG_PATH, so nothing outside this process tree is changed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
for tool in pulseaudio pactl; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool (apt-get install -y pulseaudio pulseaudio-utils libasound2-plugins)" >&2; exit 2; }
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sr-null-sink.XXXXXX")"
export XDG_RUNTIME_DIR="$WORK/run"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
cleanup() {
  pulseaudio --kill >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# `--exit-idle-time=-1`: stay up while the command runs. Running as root only draws a warning in user mode.
pulseaudio --start --daemonize=yes --exit-idle-time=-1 --disallow-exit >"$WORK/pulse.log" 2>&1 || { cat "$WORK/pulse.log" >&2; exit 1; }
for _ in $(seq 1 50); do pactl info >/dev/null 2>&1 && break; sleep 0.1; done
pactl load-module module-null-sink sink_name=sr_null sink_properties=device.description=SrNull >/dev/null
pactl set-default-sink sr_null

cat >"$WORK/alsa.conf" <<'CONF'
pcm.!default { type pulse }
ctl.!default { type pulse }
CONF
export ALSA_CONFIG_PATH="$WORK/alsa.conf"
echo "null sink up: $(pactl list short sinks | tr '\t' ' ')"

if [ "$#" -eq 0 ]; then
  cd "$ROOT/src-tauri"
  SR_TEST_REAL_AUDIO=1 cargo test -p sr-audio-device --test real_audio -- --nocapture
else
  SR_TEST_REAL_AUDIO=1 "$@"
fi
