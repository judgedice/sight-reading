import type { CSSProperties } from 'react';
import type { KeyboardView, MidiRange } from './types.ts';

const WHITE_PCS: ReadonlySet<number> = new Set([0, 2, 4, 5, 7, 9, 11]);
const isWhite = (midi: number): boolean => WHITE_PCS.has(((midi % 12) + 12) % 12);
/** Black key width as a share of a white key. */
const BLACK_SHARE = 0.58;

type KeyState = 'out' | 'full' | 'served';

function stateOf(midi: number, full: MidiRange, served: MidiRange | undefined): KeyState {
  if (served && midi >= served[0] && midi <= served[1]) return 'served';
  if (midi >= full[0] && midi <= full[1]) return 'full';
  return 'out';
}

interface KeyBox {
  midi: number;
  white: boolean;
  /** Percent of the strip width. */
  left: number;
  right: number;
}

/** Each key's horizontal extent: white keys share the width; black keys straddle the boundary they sit on. */
export function keyBoxes(low: number, high: number): KeyBox[] {
  const whites: number[] = [];
  for (let m = low; m <= high; m++) if (isWhite(m)) whites.push(m);
  const unit = 100 / Math.max(1, whites.length);
  const boxes: KeyBox[] = [];
  let w = 0;
  for (let m = low; m <= high; m++) {
    if (isWhite(m)) {
      boxes.push({ midi: m, white: true, left: w * unit, right: (w + 1) * unit });
      w++;
    } else {
      const edge = w * unit;
      boxes.push({ midi: m, white: false, left: edge - (unit * BLACK_SHARE) / 2, right: edge + (unit * BLACK_SHARE) / 2 });
    }
  }
  return boxes;
}

function bracket(boxes: readonly KeyBox[], r: MidiRange): CSSProperties {
  const lo = boxes.find((b) => b.midi === r[0]) ?? boxes[0];
  const hi = boxes.find((b) => b.midi === r[1]) ?? boxes[boxes.length - 1];
  const left = lo?.left ?? 0;
  const right = hi?.right ?? 100;
  return { left: `${left}%`, width: `${Math.max(0, right - left)}%` };
}

const pct = (n: number): string => `${Math.round(n * 1000) / 1000}%`;

export interface KeyboardStripProps {
  keyboard: KeyboardView;
  showServed?: boolean;
  /** 34 px keys in place of 40 (06 section 6.10). */
  compact?: boolean;
}

/**
 * Keyboard strip under the large staff (06 section 6.10, D5): sounding pitch, C to C, with the full range bracket
 * (4 px `range-full-bar`) and the served bracket (5 px `accent`) above, keys tinted by range, a dot on middle C and
 * the C's named below. Decorative: the legend says the same in words.
 */
export function KeyboardStrip({ keyboard, showServed = true, compact = false }: KeyboardStripProps) {
  const boxes = keyBoxes(keyboard.low, keyboard.high);
  const served = showServed ? keyboard.served : undefined;
  return (
    <div className={compact ? 'rp-kb rp-kb-compact' : 'rp-kb'} aria-hidden="true" data-testid="keyboard-strip">
      <div className="rp-kb-brackets">
        <i className="rp-kb-bracket-full" style={bracket(boxes, keyboard.full)} data-testid="kb-bracket-full" />
        {served ? <i className="rp-kb-bracket-served" style={bracket(boxes, served)} data-testid="kb-bracket-served" /> : null}
      </div>
      <div className="rp-kb-keys">
        {boxes.map((b) => {
          const state = stateOf(b.midi, keyboard.full, served);
          return (
            <span
              key={b.midi}
              className={`rp-kb-key ${b.white ? 'rp-kb-white' : 'rp-kb-black'} rp-kb-${state}`}
              style={{ left: pct(b.left), width: pct(b.right - b.left) }}
              data-midi={b.midi}
              data-state={state}
            >
              {b.midi === keyboard.middleC ? <span className="rp-kb-dot" data-testid="kb-middle-c" /> : null}
            </span>
          );
        })}
      </div>
      <div className="rp-kb-labels">
        {keyboard.cs.map((m) => {
          const box = boxes.find((b) => b.midi === m);
          return (
            <span key={m} style={{ left: pct(box?.left ?? 0) }}>
              {`C${Math.floor(m / 12) - 1}`}
            </span>
          );
        })}
      </div>
    </div>
  );
}
