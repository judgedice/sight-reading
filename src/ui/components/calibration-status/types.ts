/**
 * What the pill reads. It is the shape of `CalStatus` in `src/app/compose/calibration-status.ts`; the UI layer may not
 * import the app layer, so the fields are copied structurally and the screens pass the status unchanged.
 */
import type { OutputMode } from '../../../core/types.ts';

/** `delay`: measured, above the ranked ceiling (round 3, R80). */
export type CalStateView = 'ok' | 'none' | 'changed' | 'failed' | 'delay';

export interface CalStatusView {
  state: CalStateView;
  /** The current output (`ok`, `changed`). */
  output: OutputMode | null;
  /** `changed`: the output the earlier calibration was for. */
  oldOutput: OutputMode | null;
  /** `ok`: when it was measured. */
  when: 'today' | 'yesterday' | { date: string } | null;
  /** `ok`, `delay`: the delay the setup adds, whole ms. */
  ms: number | null;
  /** `delay`: the ranked ceiling, ms. */
  maxMs?: number | null;
  /** `failed`: copy key of the reason line. */
  reason: string | null;
  reasonVars?: Readonly<Record<string, number>> | null;
}

/** `header`: a pill with a popover. `line`: text and a link. `card-row`: the last row of the phone summary card. */
export type CalStatusVariant = 'header' | 'line' | 'card-row';
