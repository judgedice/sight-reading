# Why the calibration banner kept coming back: findings (R2-03)

Each cause from `06-plan.md` section 3, with the evidence and what changed. "Old behaviour" tests are in the files named; each shows the old behaviour and then the fix.

| # | Cause | Verdict | Fixed by |
| --- | --- | --- | --- |
| 1 | Only an accepted run is stored | Confirmed (by design, but silent) | `cal:lastFailure` and the `failed` state |
| 2 | Dismiss lasts one page load | Confirmed | No banner, no dismissal; status is derived |
| 3 | Banner and Ranked use different tests | Confirmed | `calibrationStatus` calls `rankedAvailability` |
| 4 | Recheck shift with nothing to compare | Confirmed | `recheckShiftApplies` |
| 5 | Route key hashes an unstable label | Confirmed (structural; not yet observed on the owner's Mac) | `normalizeInputLabel`, aliases, adoption |
| 6 | Origin per dev port, StrictMode | Origin: environmental, not a code cause. StrictMode: ruled out | Nothing to change |
| 7 | Clock-rate gate stops a good run | Ruled out in the current code | Test pins it |

## 1. Only an accepted run is stored: confirmed

Evidence: `CalibrationCard.tsx` lines 340 and 345 call `services.save` only when `outcome.accepted && outcome.calibration`. `analyzeLoopback` sets `accepted` only from the click count, spread and round-trip range (`src/calibration/loopback.ts` 113 to 117). A failed run therefore stores nothing and leaves nothing behind, so the next visit looked exactly like never having tried.

Fix, in `calibration-services.ts`: a run that is not accepted (or throws) writes kv `cal:lastFailure` (`{ at, method, reason, vars? }`; `reason` is an existing copy key such as `calibrate.fail.loopback.spread`). `save` clears it. `calibrationStatus` returns `failed` while the key is set and nothing is stored for the route. A kv that fails never turns a run into an error.
Tests: `calibration-services.test.ts` "cause 1" (old: no trace, status `none`; fix: failure written, status `failed`, cleared by `save`), `calibration-status.test.ts` "failed".

The card still saves only accepted runs. That is right: a rejected measurement must not become a calibration.

## 2. Dismissing lasted one page load: confirmed

Evidence: `app-services.ts` line 111, `const dismissed = createValue<...>([])`, an in-memory value; it is read at line 292 and set at line 309 and never persisted. The test reproduces the old rule (`oldBannerWouldShow`) as a model of that code and shows it returns after a reload.
Fix: the banner and its dismissal are deleted by R2-08. `calibrationStatus` takes no dismissal input and is derived from stored facts only, so a reload gives the same answer.
Test: `calibration-status.test.ts` "cause 2".

## 3. The banner and Ranked used different tests: confirmed

Evidence: `app-services.ts` line 146, `hasCalibration` is "any stored calibration whose method is not `reported`". `rankedAvailability` (`session/gates/availability.ts`) needs `calibrationForRoute`: measured, not stale, for the route key. A calibration for another output, or a stale one, kept the banner quiet while Ranked said "calibrate".
Fix: `calibrationStatus` calls `rankedAvailability` itself for its yes/no, so `state === 'ok'` exactly when `block !== 'calibration'`. A generated table of 1,080 combinations (stored calibrations of 3 methods, stale or not, 3 outputs and 2 routes, singly and in pairs; route known, unknown or never seen; 3 output modes; failure or not) checks it.
Tests: `calibration-status.test.ts` "one source of truth" and "cause 3".

## 4. Recheck shift with nothing to compare: confirmed

Evidence: `decideRecheck` (`calibration/recheck.ts`) compares the count-in with "the latency the take started with", which for an uncalibrated take is the reported estimate, and sets `promptRecalibrate` on a difference above the threshold. `ResultsPanel.tsx` line 355 shows the banner on `promptRecalibrate` alone, without looking at `calibration.method`.
Fix: `recheckShiftApplies({ method, recheck })` is true only for `loopback` or `play-along`. R2-08 or the results owner must use it at `ResultsPanel.tsx` line 355 (not in this package's paths).
Test: `calibration-status.test.ts` "cause 4".

## 5. Route key instability: confirmed

Evidence: `routeKeyOf` hashed `track.label` as the browser reported it. Chrome reports the system default input as "Default - <device>" and the communications device as "Communications - <device>" (Chrome's virtual default entries). When the default changes, the same microphone is reported with or without the prefix. The test shows the old keys differ for the same microphone: `legacyRouteKeyOf('Default - MacBook Pro Microphone (Built-in)', ...)` is not the key of the plain label. I could not read a real Mac label here (Chromium's fake device has a fixed name); the prefixes are from Chrome's documented behaviour and the plan's report, so this is confirmed by construction, and the owner should check a real label once (open the diagnostics file after a calibration: the route's `inputKind` is there, the label is never stored).

Fix, in `route.ts`: `normalizeInputLabel` strips one leading "Default - " or "Communications - " (case-insensitive) before hashing. Old keys stay readable: `routeKeyAliasesOf(label, ...)` returns the current key first, then the keys the old code made for the plain label and for each prefixed form. `adoptLegacyCalibrations(repos, aliases)` (`calibration-services.ts`) copies the newest legacy record to the current key when the current key has none, and keeps the old record. A calibration stored under "Default - MacBook Pro Microphone (Built-in)" therefore applies under "MacBook Pro Microphone (Built-in)".
Tests: `route.test.ts` "cause 5", `calibration-services.test.ts` "cause 5" (adopted record makes the status `ok`).

Not done here (other owners): the backend must expose the aliases on the route (`AudioRouteInfo`, `web-audio-backend.ts`) and the composition root must call `adoptLegacyCalibrations` when a route becomes known. Until then only new calibrations use the stable key; old ones adopt once that is wired.

## 6. One origin per dev port, StrictMode: origin is environmental, StrictMode ruled out

Origin: IndexedDB is per origin and the database name is the constant `srt` (`idb-repos.ts` line 9), so a dev server on another port starts empty. That is how browsers work, it affects only the dev build, and nothing in the code can share it. It explains a developer "losing" a calibration between ports, not the owner's Mac using one origin. No fix; the doc is the fix.

StrictMode: `src/main.tsx` and `src/app/main.tsx` use it. A calibration run is started from a click handler (`run` in `CalibrationCard.tsx`), not from an effect, so a double effect cannot start or save one. The calibrations store has `keyPath: 'routeKey'` (`idb-repos.ts` line 35), so saving twice replaces, never duplicates, and never drops the record.
Tests: `calibration-services.test.ts` "cause 6" (two saves and two runs leave one record and no failure).

## 7. The clock-rate gate: ruled out in the current code

Evidence: the clock check feeds only `clockRateError` into the stored record (`calibration/run.ts` lines 192 and 251) and the take gate (`evaluateTakeGate`, `clockOk`). It is not part of `accepted`. `services.ts` also turns a throw into `null`, and an unmeasured result has `error: null`, which fails nothing.
Tests: `calibration-services.test.ts` "cause 7": a loopback run on a clean synthetic path is accepted and carries a calibration when the clock check is unmeasured, throws, or reports an out-of-range error after a recreate; the measured error is recorded and never used to reject. If the clock-rate engineers' work later makes `accepted` depend on it, these tests fail.

## What else was learned

- The most likely reason the owner's banner never went away was cause 1 with cause 5: either a run did not pass and left no trace, or a pass was stored under a prefixed-label key that the next visit did not match.
- `calibrationStatus` returns `reason` as a copy key and an optional `reasonVars` (for `calibrate.fail.loopback.few`, `{found}` and `{total}`), an addition to the plan contract. `output` and `oldOutput` are output mode ids (`speakers`, `wired`, `bluetooth`); the screen names them from copy.
