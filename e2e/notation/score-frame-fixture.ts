// Test excerpts for the ScoreFrame (D3) unit tests and e2e page: a fixture-corpus line repeated to an exact bar
// count, so the 04 §4.3 worked cases (8, 10 and 12 bars) can be built. Ties, slurs, hairpins and dynamics are
// dropped so repeated bars join cleanly. Test-only.
import type { ExcerptDoc, PreparedExcerpt } from '../../src/core/types.ts';
import { preparedFromDoc } from '../../src/notation/testing/prepared.ts';

/** The 4/4 voice line used by the D3 tests (8 bars, no pickup, at most 8 tickables per bar). */
export const FRAME_FIXTURE_ID = 'holmes-lc5855050-voice-m1-8';

export function barsExcerpt(doc: ExcerptDoc, barCount: number): PreparedExcerpt {
  const base = preparedFromDoc(doc, 'treble');
  const bars = base.measures.filter((m) => !m.isPickup);
  const perBar = base.meter.countsPerBar * base.meter.countUnitTicks;
  const measures: PreparedExcerpt['measures'] = [];
  for (let k = 0; k < barCount; k++) {
    const m = bars[k % bars.length]!;
    const r = Math.floor(k / bars.length);
    measures.push({
      index: k,
      isPickup: false,
      startTick: k * perBar,
      displayBar: k + 1,
      events: m.events.map((e) => {
        const shifted = { ...e, id: `${e.id}~${r}`, tick: k * perBar + (e.tick - m.startTick) };
        if (shifted.kind === 'note') {
          delete (shifted as { tieStart?: true }).tieStart;
          delete (shifted as { tieStop?: true }).tieStop;
          delete (shifted as { slur?: string }).slur;
          delete (shifted as { hairpin?: string }).hairpin;
          delete (shifted as { dynamic?: string }).dynamic;
        }
        return shifted;
      }),
    });
  }
  return { ...base, excerptId: `${base.excerptId}x${barCount}`, pickupTicks: 0, measures, barRhythmLevel: measures.map(() => 1) };
}
