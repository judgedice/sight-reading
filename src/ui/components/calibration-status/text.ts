// The words of the calibration status, from the copy catalogue (01-ux section 4, 04-design section 2).
import { copy, isCopyKey } from '../../copy/copy.ts';
import type { CalStatusView } from './types.ts';

/** About how long a calibration takes, seconds, when the screen does not say (the loopback run). */
export const DEFAULT_CALIBRATE_SECONDS = 20;

const OUTPUT_KEY = { speakers: 'output.speakers', wired: 'output.wiredHeadphones', bluetooth: 'output.bluetooth' } as const;

function outputName(o: CalStatusView['output']): string {
  const name = copy(OUTPUT_KEY[o ?? 'speakers']);
  // Mid-sentence: "Calibrated for speakers", "Output changed to Bluetooth".
  return o === 'bluetooth' ? name : name.toLowerCase();
}

function whenName(w: CalStatusView['when']): string {
  if (w === 'yesterday') return copy('calStatus.when.yesterday');
  if (w !== null && typeof w === 'object') return copy('calStatus.when.date', { date: w.date });
  return copy('calStatus.when.today');
}

export interface CalTexts {
  /** The pill text, whole (the changed state ends with its action). */
  full: string;
  /** The pill text when the header is narrow; same as `full` except for `ok`. */
  short: string;
  /** The text without a trailing action, for lines that show the action as a link beside it. */
  lead: string;
  /** The popover title. */
  title: string;
  /** The popover detail line. */
  detail: string;
  /** The popover and link action. */
  action: string;
}

function stripAction(text: string, again: string): string {
  const tail = `. ${again}`;
  return text.endsWith(tail) ? text.slice(0, -tail.length) : text;
}

export function calTexts(s: CalStatusView, seconds: number = DEFAULT_CALIBRATE_SECONDS): CalTexts {
  const again = copy('calStatus.action.again');
  const calibrate = copy('calStatus.action.calibrate');
  switch (s.state) {
    case 'ok': {
      const full = copy('calStatus.ok', { output: outputName(s.output), when: whenName(s.when) });
      return {
        full,
        short: copy('calStatus.ok.short', { when: whenName(s.when) }),
        lead: full,
        title: full,
        detail: copy('calStatus.ok.detail', { ms: s.ms ?? 0 }),
        action: again,
      };
    }
    case 'changed': {
      const full = copy('calStatus.changed', { output: outputName(s.output) });
      const lead = stripAction(full, again);
      return {
        full,
        short: full,
        lead,
        title: lead,
        detail: copy('calStatus.changed.detail', { oldOutput: outputName(s.oldOutput), output: outputName(s.output) }),
        action: again,
      };
    }
    case 'failed': {
      const reason = s.reason !== null && isCopyKey(s.reason) ? copy(s.reason, { ...(s.reasonVars ?? {}) }) : '';
      const full = copy('calStatus.failed');
      return { full, short: full, lead: full, title: full, detail: copy('calStatus.failed.detail', { reason }).trim(), action: calibrate };
    }
    case 'none':
    default: {
      const full = copy('calStatus.none');
      return { full, short: full, lead: full, title: full, detail: copy('calStatus.none.detail', { seconds }), action: calibrate };
    }
  }
}
