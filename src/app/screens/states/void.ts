/** Void cards (04 section 9.3) and practise without listening (R13, 04 section 9.2). */
import type { PracticeSettings, VoidReason } from '../../../core/types.ts';
import type { CopyKey } from '../../../ui/copy/copy.ts';

export type VoidAction = 'try-again' | 'check-microphone' | 'recalibrate';

export interface VoidCopy {
  key: CopyKey;
  actions: VoidAction[];
}

/** One card per reason; backlog and capture-gap share copy. */
export function voidCopy(reason: VoidReason): VoidCopy {
  switch (reason) {
    case 'interrupted':
      return { key: 'void.interrupted', actions: ['try-again'] };
    case 'no-signal':
      return { key: 'void.noSignal', actions: ['check-microphone', 'try-again'] };
    case 'device-change':
      return { key: 'void.deviceChange', actions: ['recalibrate'] };
    case 'backlog':
      return { key: 'void.backlog', actions: ['try-again'] };
    case 'capture-gap':
      return { key: 'void.captureGap', actions: ['try-again'] };
    case 'stopped-before-first-note':
      return { key: 'void.stopped', actions: ['try-again'] };
  }
}

/**
 * Settings for a take without capture: scan, metronome, count-in and bar highlight run, nothing is graded and no
 * XP is earned (R13). It is a practice take that is not listened to.
 */
export function practiseWithoutListening(s: PracticeSettings): PracticeSettings {
  return { ...s, listening: false, mode: 'practice' };
}
