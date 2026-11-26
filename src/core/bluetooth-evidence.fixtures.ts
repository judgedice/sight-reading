/**
 * Numbers from the owner's diagnostics exports (Chrome on a MacBook, built-in microphone and speakers, no Bluetooth
 * device; round 3, Bluetooth false positive). Numbers and enum values only: no audio, no labels, no device ids.
 * The exports do not include the microphone track's own rate or the input label, so neither is here.
 */
export const MAC_BUILT_IN = {
  osFamily: 'macos',
  outputMode: 'speakers',
  /** `device.route.inputKind` of the 2026-11-22 try (`unknown` in the 2026-11-20 tries). */
  inputKind: 'built-in',
  contextSampleRate: 48000,
  /** Self-test export 2026-11-19 (`route.reportedLatencyMs`, baseLatency + outputLatency). */
  reportedLatencyMs: 30.33,
  /** Loopback calibration used by the 2026-11-22 try. */
  loopback: { roundTripMs: 95.47687776098002, spreadMs: 0.11379661319210754, clicksDetected: 10, aecSuspected: false },
  /** Per-take count-in rechecks: 2026-11-22, then the two 2026-11-20 tries. */
  rechecksMs: [96.65242424242138, 86.0933333333378, 100.8600000000115],
  /** Self-test export 2026-11-19: loopback clicks 10 of 10. */
  selfTestLoopback: { rtlMs: 42.84, madMs: 0.24 },
} as const;
