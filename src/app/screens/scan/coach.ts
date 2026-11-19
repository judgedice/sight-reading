/**
 * The sounds coach mark shows on the first read-through only (05 section 4.2 step 4). The settings have no flag for it
 * yet (`AppSettings.shown` holds installCoach and autoLockHint only) and screens may not reach browser storage
 * (01 section 4.3), so for now "seen" lasts for the app's lifetime: the mark shows on the first read-through after
 * each launch. A stored `shown.soundsCoach` flag through the session's services is the fix (reported).
 */
let seen = false;

export function soundsCoachSeen(): boolean {
  return seen;
}

export function markSoundsCoachSeen(): void {
  seen = true;
}

/** Tests and the story page only. */
export function resetSoundsCoach(): void {
  seen = false;
}
