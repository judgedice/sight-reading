import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configs } from '../../../../fixtures/follow/gen/io.ts';
import type { Configs, PracticeSettings, SelectionHistory } from '../../../core/types.ts';
import { createRng } from '../../../core/rng.ts';
import { countEligible, METER_MIN_EXCERPTS, selectExcerptWith } from '../../../corpus/select/index.ts';
import { shippedManifest } from '../../../corpus/select/testing/shipped.ts';
import { tokens } from '../../../ui/tokens.ts';
import {
  applySetupChange,
  fallbackNotes,
  formatLevelList,
  formatMeterList,
  meterChoices,
  normalize,
  setupModel,
  setupText,
  shownMeterSet,
  stepLevel,
  type EligibleFn,
  type SetupContext,
  type SetupModel,
  type SetupText,
} from './model.ts';

const cfg: Configs = configs();
const manifest = shippedManifest((f) => readFileSync(new URL(`../../../../public/corpus/v1/${f}`, import.meta.url), 'utf8'));
const shippedEligible: EligibleFn = (id, level, meter) => countEligible(manifest, id, level, meter, cfg);

function ctxWith(eligible: EligibleFn = shippedEligible, playerLevel = 2): SetupContext {
  return { cfg, eligible, showBeta: false, playerLevel: () => playerLevel };
}

const base = (over: Partial<PracticeSettings> = {}): PracticeSettings => ({
  instrumentId: 'flute',
  level: 2,
  writtenKey: 'random',
  meter: 'random',
  bpm: 'random',
  bars: 'random',
  mode: 'ranked',
  listening: true,
  metronome: 'audible',
  clickTimbre: 'tick',
  outputMode: 'speakers',
  a4Hz: 440,
  ...over,
});

const t = (x: SetupText | null | undefined): string | null => (x ? setupText(x) : null);
const model = (over: Partial<PracticeSettings>, ctx = ctxWith()): SetupModel => setupModel(normalize(base(over), ctx), ctx);
/** The Key row as the player reads it: "Any key", then each group's tonic names. */
const keyRowText = (m: SetupModel): string[] => [t(m.key.any.label)!, ...m.key.groups.flatMap((g) => [t(g.label)!, ...g.keys.map((k) => k.tonic)])];

const INSTRUMENTS = ['flute', 'voice-bass', 'trumpet-bb', 'cello'] as const;
const NAMES: Record<(typeof INSTRUMENTS)[number], string> = {
  flute: 'Flute',
  'voice-bass': 'Bass voice',
  'trumpet-bb': 'Trumpet (B♭)',
  cello: 'Cello',
};

describe('thresholds', () => {
  it('the selector and the screen share the design-token thresholds', () => {
    expect(METER_MIN_EXCERPTS).toBe(tokens.ui.meterChipMinExcerpts);
  });
});

describe('setup model at difficulty 1, 2, 5 and 9', () => {
  for (const id of INSTRUMENTS) {
    for (const level of [1, 2, 5, 9]) {
      it(`${id} at difficulty ${level}`, () => {
        const m = model({ instrumentId: id, level });
        const def = cfg.levelByNumber[level]!;
        expect(m.level).toBe(level);
        expect(m.instrumentName).toBe(NAMES[id]);

        // Difficulty: every launch instrument has music at every difficulty in the shipped corpus.
        expect(m.difficulty.withMusic).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(m.difficulty.skippedNote).toBeNull();
        expect(m.difficulty.description).toBe(def.description);
        expect(m.difficulty.few).toBe(shippedEligible(id, level, null) < tokens.ui.levelThinThreshold);
        expect(t(m.difficulty.fewNote)).toBe(m.difficulty.few ? 'Few pieces here: some may repeat.' : null);
        expect(m.difficulty.segments.filter((s) => s.filled).length).toBe(level);

        // Key: Any first, Major then Minor, by accidentals with the sharp side first.
        expect(m.key.any.selected).toBe(true);
        expect(t(m.key.any.xpTag)).toBe('+8% XP');
        expect(m.key.groups.map((g) => g.mode)).toEqual(def.writtenKeys.modes);
        for (const g of m.key.groups) {
          expect(g.keys.length).toBe(1 + 2 * def.writtenKeys.maxAccidentals);
          expect(g.keys.map((k) => k.key.fifths)).toEqual(
            [0, ...Array.from({ length: def.writtenKeys.maxAccidentals }, (_, i) => [i + 1, -(i + 1)]).flat()],
          );
          for (const k of g.keys) expect(k.concert !== null).toBe(id === 'trumpet-bb');
        }

        // Time: Any first; the meters shown are exactly those the selector may draw with time Any.
        const counts = def.meters.map((meter) => ({ meter, count: shippedEligible(id, level, meter) }));
        const shown = shownMeterSet(counts);
        expect(m.time.any.selected).toBe(true);
        expect(t(m.time.any.label)).toBe('Any');
        expect(m.time.options.map((o) => o.meter)).toEqual(def.meters.filter((x) => shown.has(x)));
        expect(m.time.hidden).toEqual(def.meters.filter((x) => !shown.has(x)));
        for (const o of m.time.options) expect(o.few).toBe(o.count < tokens.ui.levelThinThreshold);
        if (m.time.hidden.length > 0) {
          expect(t(m.time.hiddenNote)).toBe(`No ${formatMeterList(m.time.hidden)} music for ${NAMES[id]} at difficulty ${level} yet.`);
        }

        // Length: one value is a line of text, more is a segmented control with Any first.
        if (level <= 2) {
          expect(m.length.kind).toBe('only');
          if (m.length.kind === 'only') expect(t(m.length.note)).toBe(`8 bars (the only length at difficulty ${level})`);
        } else {
          expect(m.length.kind).toBe('choice');
          if (m.length.kind === 'choice') {
            expect(m.length.options.map((o) => o.bars)).toEqual(level === 5 ? [8, 10] : [8, 10, 12]);
            expect(m.length.any.selected).toBe(true);
          }
        }

        // Tempo and XP.
        expect(t(m.tempo.anyValue)).toBe(`Any tempo from ${def.tempo.minBpm} to ${def.tempo.maxBpm}`);
        expect(t(m.xp.line)).toBe('Choosing Any: +24% XP');
      });
    }
  }

  it("keys at difficulty 1: 'Any key, C, G, F'", () => {
    for (const id of INSTRUMENTS) expect(keyRowText(model({ instrumentId: id, level: 1 }))).toEqual(['Any key', 'Major', 'C', 'G', 'F']);
    const m = model({ level: 1 });
    expect(t(m.key.any.hint)).toBe('Any key up to 1 sharp or flat');
    expect(t(m.key.moreNote)).toBe('More keys from difficulty 2.');
  });

  it('keys at difficulty 2: Any key; Major C, G, F; Minor A, E, D', () => {
    const m = model({ instrumentId: 'voice-bass', level: 2 });
    expect(keyRowText(m)).toEqual(['Any key', 'Major', 'C', 'G', 'F', 'Minor', 'A', 'E', 'D']);
    expect(t(m.key.moreNote)).toBe('More keys from difficulty 3.');
  });

  it('keys at difficulty 5 and 9', () => {
    const m5 = model({ instrumentId: 'cello', level: 5 });
    expect(m5.key.groups[0]!.keys.map((k) => k.tonic)).toEqual(['C', 'G', 'F', 'D', 'B♭', 'A', 'E♭', 'E', 'A♭']);
    expect(m5.key.groups[1]!.keys.map((k) => k.tonic)).toEqual(['A', 'E', 'D', 'B', 'G', 'F♯', 'C', 'C♯', 'F']);
    expect(t(m5.key.any.hint)).toBe('Any key up to 4 sharps or flats');
    expect(t(m5.key.moreNote)).toBe('More keys from difficulty 6.');
    const m9 = model({ instrumentId: 'cello', level: 9 });
    expect(m9.key.groups[0]!.keys.at(-1)!.name).toBe('C♭ major');
    expect(m9.key.moreFrom).toBeNull();
    expect(m9.key.moreNote).toBeNull();
  });

  it('trumpet in B♭ shows concert keys', () => {
    const m = model({ instrumentId: 'trumpet-bb', level: 2, writtenKey: { fifths: 1, mode: 'major' } });
    const g = m.key.groups[0]!.keys.find((k) => k.name === 'G major')!;
    expect(g.selected).toBe(true);
    expect(m.key.any.selected).toBe(false);
    expect(t(g.concert)).toBe('concert F major');
    expect(t(m.key.groups[0]!.keys[0]!.concert)).toBe('concert B♭ major');
    expect(t(m.xp.line)).toBe('Choosing Any: +16% XP');
  });

  it('served range lines come from the instrument tier', () => {
    expect(setupText(model({ instrumentId: 'voice-bass', level: 1 }).difficulty.servedLine)).toBe('At difficulty 1: A2 to A3');
    expect(setupText(model({ instrumentId: 'flute', level: 5 }).difficulty.servedLine)).toBe('At difficulty 5: C4 to C6');
    expect(setupText(model({ instrumentId: 'cello', level: 9 }).difficulty.servedLine)).toBe('At difficulty 9: E2 to A5');
    expect(setupText(model({ instrumentId: 'trumpet-bb', level: 2 }).difficulty.servedLine)).toBe('At difficulty 2: C4 to C5');
  });

  it('time rows on the shipped corpus', () => {
    // Bass voice at 2: 4/4 has 6, 3/4 has 2, 2/4 none.
    const bass2 = model({ instrumentId: 'voice-bass', level: 2 });
    expect(bass2.time.options.map((o) => [o.meter, o.few])).toEqual([['4/4', true]]);
    expect(bass2.time.hidden).toEqual(['3/4', '2/4']);
    // Flute at 1: no meter reaches 5, so every meter with music is shown, each with few pieces.
    const fl1 = model({ instrumentId: 'flute', level: 1 });
    expect(fl1.time.options.map((o) => o.meter)).toEqual(['4/4', '3/4']);
    expect(fl1.time.options.every((o) => o.few)).toBe(true);
    expect(t(fl1.time.hiddenNote)).toBe('No 2/4 music for Flute at difficulty 1 yet.');
    // Cello at 5: 2/2 has exactly 5 (shown, few); 3/8 and 3/2 are left out.
    const c5 = model({ instrumentId: 'cello', level: 5, meter: '2/2' });
    expect(c5.time.options.map((o) => o.meter)).toEqual(['4/4', '3/4', '2/4', '6/8', '2/2']);
    expect(c5.time.options.find((o) => o.meter === '2/2')).toMatchObject({ count: 5, few: true, selected: true });
    expect(t(c5.time.fewNote)).toBe('Few pieces here: some may repeat.');
    expect(c5.time.hidden).toEqual(['3/8', '3/2']);
    expect(t(c5.time.options[0]!.a11y)).toBe('4 4 time');
  });
});

describe('difficulty without music', () => {
  /** A baritone-like instrument with no music at difficulty 7 and 8. */
  const gap: EligibleFn = (_id, level, meter) => (level === 7 || level === 8 ? 0 : meter === null ? 40 : 12);

  it('names the skipped difficulties and steps over them', () => {
    const ctx = ctxWith(gap);
    const m = model({ instrumentId: 'voice-bass', level: 6 }, ctx);
    expect(m.difficulty.skipped).toEqual([7, 8]);
    expect(t(m.difficulty.skippedNote)).toBe('No music yet for Bass voice at difficulty 7 to 8.');
    expect(m.difficulty.next).toBe(9);
    expect(m.difficulty.segments.filter((s) => !s.hasMusic).map((s) => s.level)).toEqual([7, 8]);
    expect(stepLevel(m.difficulty.counts, 9, -1)).toBe(6);
    expect(formatLevelList([1, 7, 8, 10])).toBe('1, 7 to 8, 10');
  });

  it('follow my progress hides the stepper and keeps the lines', () => {
    const m = model({ level: 'random' }, ctxWith(shippedEligible, 3));
    expect(m.difficulty.follow).toBe(true);
    expect(t(m.difficulty.followValue)).toBe('Difficulty 3 of 10 (follows your progress)');
    expect(t(m.difficulty.followHint)).toBe('Uses your current difficulty and moves up as you do.');
    expect(setupText(m.difficulty.servedLine)).toBe('At difficulty 3: D4 to G5');
  });
});

describe('fallback notes (5.9)', () => {
  const ctx = ctxWith();

  it('key, time and length fall back to Any with a note', () => {
    const cur = normalize(base({ instrumentId: 'cello', level: 5, writtenKey: { fifths: 1, mode: 'minor' }, meter: '6/8', bars: 10 }), ctx);
    const r = applySetupChange(cur, { level: 1 }, ctx);
    expect(r.next.writtenKey).toBe('random');
    expect(r.next.meter).toBe('random');
    expect(r.next.bars).toBe('random');
    expect(r.notes.map((n) => [n.row, t(n.note)])).toEqual([
      ['key', "Key set to Any: E minor isn't used at difficulty 1."],
      ['time', "Time signature set to Any: 6/8 isn't available at difficulty 1."],
      ['length', "Length set to Any: 10 bars isn't used at difficulty 1."],
    ]);
  });

  it('a difficulty without music moves to the nearest with music', () => {
    const none2: EligibleFn = (_id, level, meter) => (level === 2 ? 0 : meter === null ? 40 : 12);
    const c = ctxWith(none2);
    const r = applySetupChange(base({ instrumentId: 'flute', level: 1 }), { instrumentId: 'voice-bass', level: 2 }, c);
    expect(r.next.level).toBe(1);
    expect(r.notes.map((n) => t(n.note))).toEqual(['Difficulty set to 1: no music yet for Bass voice at difficulty 2.']);
  });

  it('a clamped tempo is silent and a kept choice gives no note', () => {
    const cur = normalize(base({ level: 5, bpm: 110, writtenKey: { fifths: 0, mode: 'major' } }), ctx);
    const r = applySetupChange(cur, { level: 2 }, ctx);
    expect(r.next.bpm).toBe(84);
    expect(r.next.writtenKey).toEqual({ fifths: 0, mode: 'major' });
    expect(r.notes).toEqual([]);
    expect(fallbackNotes(cur, cur, ctx)).toEqual([]);
  });

  it('a chosen meter the row hides falls back to Any', () => {
    const r = applySetupChange(base({ instrumentId: 'voice-bass', level: 2 }), { meter: '3/4' }, ctx);
    expect(r.next.meter).toBe('random');
    expect(meterChoices(ctx, 'voice-bass', 2).find((c) => c.meter === '3/4')!.disabled).toBe(true);
  });
});

describe('time Any draws only meters the setup shows', () => {
  const launch = cfg.instruments.instruments.filter((i) => i.status === 'launch');
  const history = (level: number): SelectionHistory => ({ seenGroups: {}, recentExcerptIds: [], recentWorks: [], recentWrittenKeys: [], playerLevel: level });

  for (const inst of launch) {
    it(`${inst.id}: 200 draws per difficulty never serve a hidden meter`, () => {
      const ctx = ctxWith();
      const rng = createRng(0x5e7 + inst.id.length);
      for (let level = 1; level <= 10; level++) {
        const m = model({ instrumentId: inst.id, level }, ctx);
        const shown = new Set(m.time.options.map((o) => o.meter));
        expect(shown.size).toBeGreaterThan(0);
        let served = 0;
        for (let i = 0; i < 200; i++) {
          const s = base({ instrumentId: inst.id, level, mode: i % 2 === 0 ? 'practice' : 'ranked', seed: rng.int(0, 0x7fffffff) });
          const r = selectExcerptWith(manifest, s, history(level), cfg, rng);
          if ('error' in r) continue;
          served++;
          if (!shown.has(r.settings.meter)) throw new Error(`${inst.id} difficulty ${level} served hidden ${r.settings.meter}`);
        }
        expect(served).toBeGreaterThanOrEqual(100);
      }
    }, 120_000);
  }
});
