# iOS device checklist

Source: `docs/spec/05-ios-fork.md`, section 8.2 (what only a device can show) and Part B, B3 (the promotion gate). The web build is labelled "iOS: beta" until every item here passes on the devices below. Nothing in this checklist has been run yet: the build has no iPhone or iPad available.

Status values: `pass`, `fail`, `not run`. Record the observed value and the date in `docs/ios/latency-log.md` (created on the first device run).

## Devices and modes (B3)

Run every measurement on each of these, in each of the two modes:

| Device | Notes |
| --- | --- |
| A13-class iPhone | The low-end reference. Also used for the Low Power Mode run (M4). |
| Current iPhone | |
| iPad | |

Modes: Safari tab (`displayMode` `browser`), and home-screen app (`displayMode` `standalone`).

## Part 1: items from section 8.2

Each item says what to do and what counts as a pass. Where the spec gives no number, the pass criterion is that the observed behaviour is recorded and matches the spec section named in the last column. A mismatch is a fail and goes to the owner of that section, not a tuning change in this checklist.

| ID | Item (8.2) | Procedure | Pass threshold | Spec reference |
| --- | --- | --- | --- | --- |
| 8.2-01 | Real round-trip latency (RTL) values and their stability across sessions and context instances | Run calibration in a fresh session and again after a context is recreated. Record RTL each time. | Recorded for every session; M1 applies to the spread across 20 calibrations | 05 section 8.2; B3 M1 |
| 8.2-02 | Whether `echoCancellation`, `noiseSuppression` and `autoGainControl` set to `false` are honoured, and whether AEC cancels the loopback click | Read back `getSettings()` after opening the stream (W5 `appliedProcessing`). Then run loopback calibration with the speaker on and check the detected click count and level. | Recorded per device and mode. A `true` readback is a `processing-on` gate failure, not a silent pass. Clicks cancelled by AEC make loopback unusable, so calibration falls back to play-along | 05 W5, section 4; 8.2; 01 section 7.7 |
| 8.2-03 | Receiver routing and quiet output while capturing; silent-switch behaviour before capture | Start a take with output set to speakers and check the output is audible and not routed to the receiver. Repeat with the silent switch on before a calibration and a take. | Recorded for each device and mode. Receiver routing is a fail for speaker mode | 05 section 8.2 |
| 8.2-04 | The 44.1/48 kHz mis-resampling bug, including the pitch-shift form with a correct clock rate in headphone mode | Run the in-app self-test (01 section 7.9) and the W3 clock-rate check. For the pitch-shift form, play a known A4 and read the detected pitch. | No mismatch between context rate and track rate; pitch error within the cents budget (M2) | 05 W3, section 8.2 |
| 8.2-05 | Whether an unconnected worklet runs, and whether `MessagePort` transfer into the worklet works | Check that blocks reach the DSP worker contiguously by `seq` for 30 s on the port path; repeat on the forced main-thread relay. | Contiguous blocks, no `capture-gap`, on both paths | 05 IOS7; W4 |
| 8.2-06 | First-output drop after resume and the first-click check | Resume the context from a gesture, then play a calibration click at the start. Check the first click is heard and measured. | Recorded. A dropped first click is a fail for the calibration that uses it | 05 W1, W9 |
| 8.2-07 | Wake lock in home-screen mode before and after 18.4 | Start scan, leave the screen untouched for 60 s with Auto-Lock at 30 s, and check the screen stays on. Repeat on each OS version available. | Screen stays on for the whole scan. A rejection shows the Auto-Lock hint once (IOS5) | 05 W11; section 8.2 |
| 8.2-08 | Permission re-prompt frequency in a tab and as a home-screen app; `permissions.query` behaviour | Deny, then re-open, the microphone prompt in each mode. Note how often it appears and what `permissions.query` returns. | Recorded. The copy in `permission.denied.iosHomeScreen` matches what the device does | 05 section 7 item 9; 8.2 |
| 8.2-09 | Interruption state transitions with real calls, Siri and alarms | During a count-in and during a performance, trigger an incoming call, Siri and an alarm. Record which events fire (`context-interrupted`, `track-mute`, `hidden`). | Every interruption during a take voids it with `interrupted` (W4). No take continues past one | 05 W4; IOS2 |
| 8.2-10 | AirPods and HFP behaviour and detection | Connect AirPods. Check the input label, the RTL, and whether the Bluetooth banner and the AirPods hint appear. | Bluetooth message shown on a Bluetooth label (or the hands-free 8/16 kHz track after a label change), never from the RTL alone; an RTL above 120 ms shows the neutral delay message instead. Takes are unranked or flagged as in 02 | 05 W8; IOS5 |
| 8.2-11 | DSP budget on A13 in Low Power Mode and under thermal throttling | Run a 60 s take in Low Power Mode (M4). Record `dspHopP95Ms` from the diagnostics export. | M4: no backlog void. The hop time is recorded | 05 W15; 01 section 7.9; B3 M4 |
| 8.2-12 | Safari's 7-day storage deletion and the `persist()` grant | Complete one attempt, check `navigator.storage.persisted()` and the result of the persist call, then check that the storage-loss card appears if IndexedDB is cleared. | `persist()` called exactly once after the first attempt (IOS4). Grant result recorded | 05 W12; IOS4 |
| 8.2-13 | Real Safari chrome heights, the iOS 26 floating bar, Stage Manager live resize | Check every viewport in 05 section 7 (V1 to V7) on the device, and resize the window in Stage Manager during a take. | No score-frame overflow; a mid-take resize causes no re-render (IOS6) | 05 section 7; IOS6 |
| 8.2-14 | VoiceOver behaviour | Run the practice flow with VoiceOver on: scan, count-in, take, results. | Recorded. Every control has a label and the Stop control is reachable | 05 section 8.2 |
| 8.2-15 | Low-instrument detection through iPhone mics | Play low-register instruments (cello, double bass, low voice) at the level-1 range through the iPhone mic. | Recorded. Detection rate compared with the headphone baseline | 05 section 8.2 |

Item count: 15 items, one per bullet in section 8.2 of the spec. The test in `src/platform/web/ios/device-checklist.test.ts` checks that the count matches.

## Part 2: B3 measurements

These are the numbers the promotion gate needs. Thresholds are from the spec. Budget values that come from `config/measurement-budget.json` are read from there and are not restated here.

| ID | Measurement | Procedure | Pass threshold | Spec reference |
| --- | --- | --- | --- | --- |
| M1 | Calibration stability | 20 calibrations per device and mode. Take the median RTL of each. | The median RTL varies by 5 ms or less across sessions | B3 |
| M2 | Reference performance | Play a reference performance from a second device and grade it on the device under test. | Onset error p90 within the phone onset budget (01 section 8.1, `config/measurement-budget.json` `onsetError`). Pitch error p90 within the cents budget (01 section 8.4, `config/measurement-budget.json` `cents`) | B3; 01 sections 8.1 and 8.4 |
| M3 | Measurement gate and voids | 50 takes per device and mode. | At least 95% of takes pass the measurement gate. Zero spurious voids | B3; section 4 |
| M4 | Low Power Mode take | A 60 s take on the A13-class iPhone in Low Power Mode. | No backlog void and no `backlog` in the diagnostics | B3; 01 section 7.9 |
| M5 | Section 8.2 recorded | Every item in Part 1 has a recorded result. | 15 of 15 items recorded | B3 |

If a measured onset error exceeds the 01 budget, 01 updates `measurement-budget.json` and 02 widens the floors in config (B3, R2). Do not change the thresholds in this file to make a run pass.

## Promotion

The "iOS: beta" label is removed only when M1 to M5 all pass on every device in both modes. The label is shown by `iosBetaLabelKey` in `src/platform/web/ios/hints.ts` and the copy key `app.beta`.
