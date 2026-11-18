// Copy catalogue tests (04 section 10, section 12; D0c acceptance): the formatter supports exactly
// the two forms, every template parses, the spec's worked strings come out exactly, and the
// catalogue carries every enum value the other roles define.
import { describe, expect, it } from 'vitest';
import { copy, copyKeys, copyTemplate, formatMessage, isCopyKey, requiredVariables } from './copy.ts';

describe('formatMessage', () => {
  it('substitutes {name} placeholders and leaves plain text alone', () => {
    expect(formatMessage('Bar {n} of {total}', { n: 4, total: 10 })).toBe('Bar 4 of 10');
    expect(formatMessage('No placeholders here.')).toBe('No placeholders here.');
  });

  it('chooses the one or other branch of a plural and replaces # with the number', () => {
    const t = '{n, plural, one {# note re-judged after the take} other {# notes re-judged after the take}}';
    expect(formatMessage(t, { n: 1 })).toBe('1 note re-judged after the take');
    expect(formatMessage(t, { n: 2 })).toBe('2 notes re-judged after the take');
    expect(formatMessage(t, { n: 0 })).toBe('0 notes re-judged after the take');
  });

  it('formats placeholders nested inside a plural branch', () => {
    const t = 'Restarted at bar {bar} ({n, plural, one {# note} other {# notes}} replayed)';
    expect(formatMessage(t, { bar: 4, n: 6 })).toBe('Restarted at bar 4 (6 notes replayed)');
  });

  it('throws when a variable is missing rather than printing undefined', () => {
    expect(() => formatMessage('Bar {n}', {})).toThrow(/missing variable "n"/);
  });

  it('throws on a plural form other than one and other', () => {
    expect(() => formatMessage('{n, plural, zero {none} other {some}}', { n: 0 })).toThrow(/unsupported plural form "zero"/);
  });

  it('throws on a non-plural format and on unbalanced braces', () => {
    expect(() => formatMessage('{n, number}', { n: 1 })).toThrow(/only plural is allowed/);
    expect(() => formatMessage('Bar {n', { n: 1 })).toThrow(/unclosed/);
  });

  it('throws when a plural has no branch for its count', () => {
    expect(() => formatMessage('{n, plural, one {# take}}', { n: 3 })).toThrow(/no plural branch/);
  });
});

describe('copy() and the typed key union', () => {
  it('reproduces the spec strings exactly', () => {
    expect(copy('welcome.headline')).toBe('Read it. Play it. See how it went.');
    expect(copy('scan.ranked.notice', { seconds: 30 })).toBe(
      "You'll have 30 seconds to read, then the count-in starts by itself. Want more time? Switch to Practice.",
    );
    expect(copy('scan.startingIn', { n: 5 })).toBe('Starting in 5');
    expect(copy('play.status.bar', { n: 4, total: 10 })).toBe('Bar 4 of 10');
    expect(copy('results.scoring')).toBe('Scoring…');
    expect(copy('grade.B')).toBe('Solid. A few slips.');
    expect(copy('ranked.reason.seen-before')).toBe("You've seen this excerpt before, so it isn't sight reading any more.");
    expect(copy('results.counts.total', { n: 42 })).toBe('42 notes');
    expect(copy('results.stops', { n: 1, bar: 5, beats: 2 })).toBe('Stops: 1 (bar 5, 2 beats)');
    expect(copy('streak.atRisk', { n: 1, days: 6 })).toBe('1 more ranked take today keeps your 6-day streak.');
    expect(copy('rankup.headline', { rank: 'Section player' })).toBe('New rank: Section player!');
    expect(copy('credit.source', { encoder: 'OpenScore Lieder contributors', corpus: 'OpenScore Lieder' })).toBe(
      'Typeset by OpenScore Lieder contributors · OpenScore Lieder · CC BY 4.0',
    );
    expect(copy('credit.that-was', { credit: 'Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0' })).toBe(
      'That was: Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0',
    );
    expect(copy('credit.line', {
      composer: 'Schubert',
      dates: '1797–1828',
      work: 'Heidenröslein, D 257',
      a: 1,
      b: 8,
      licenceShort: 'CC0',
    })).toBe('Schubert (1797–1828) · Heidenröslein, D 257 · bars 1–8 · CC0');
    expect(copy('calibrate.loopback.success', { ms: 42 })).toBe("Your setup adds 42 ms. We'll correct for it.");
  });

  it('exposes a key union that matches en.json, with the expected count', () => {
    expect(copyKeys.length).toBeGreaterThan(300);
    expect(isCopyKey('grade.S')).toBe(true);
    expect(isCopyKey('no.such.key')).toBe(false);
    // @ts-expect-error an unknown key is a compile-time error
    expect(() => copy('no.such.key')).toThrow();
  });

  it('returns the raw template unformatted', () => {
    expect(copyTemplate('play.status.bar')).toBe('Bar {n} of {total}');
  });
});

describe('en.json catalogue', () => {
  it('has a template for every key that parses, with the variables it names', () => {
    for (const key of copyKeys) {
      const template = copyTemplate(key);
      expect(template.trim(), key).not.toBe('');
      expect(() => requiredVariables(template), key).not.toThrow();
    }
  });

  it('only uses exclamation marks in the rank-up headline and the clip indicator (04 section 10.1)', () => {
    const withBang = copyKeys.filter((k) => copyTemplate(k).includes('!')).sort();
    expect(withBang).toEqual(['play.meter.clip', 'rankup.headline']);
  });

  it('has a ranked-reason string for every value of the 02 section 5.2 enum, and no others', () => {
    const enumValues = [
      'practice-mode',
      'seen-before',
      'scan-extended',
      'tempo-below-90pct',
      'visual-metronome',
      'calibration',
      'measurement',
      'familiar',
      'skip-limit',
    ];
    const keys = copyKeys.filter((k) => k.startsWith('ranked.reason.')).map((k) => k.slice('ranked.reason.'.length)).sort();
    expect(keys).toEqual([...enumValues].sort());
  });

  it('has a string for every grade letter in 02 section 4.7', () => {
    for (const g of ['S', 'A', 'B', 'C', 'D', 'F'] as const) expect(isCopyKey(`grade.${g}`)).toBe(true);
  });

  it('has licence, corpus and modification strings for every identifier in 01 section 6.1 and the runtime additions', () => {
    for (const id of ['PD', 'CC0-1.0', 'CC-BY-4.0']) expect(isCopyKey(`licence.${id}`)).toBe(true);
    for (const id of ['openscore-lieder', 'openscore-quartets', 'mutopia']) expect(isCopyKey(`corpus.${id}`)).toBe(true);
    for (const m of [
      'excerpted',
      'grace-removed',
      'ornament-removed',
      'fermata-removed',
      'lyrics-removed',
      'rhythm-augmented-x2',
      'final-bar-completed',
      'transposed',
      'octave-displaced',
    ]) {
      expect(isCopyKey(`mod.${m}`), m).toBe(true);
    }
  });

  it('has a void-card string for each VoidReason the spec gives copy for (9.3)', () => {
    // 'clipping' is a VoidReason in 01 but 04 gives it a results banner, not a void card; see the wave 0 report.
    for (const v of ['interrupted', 'noSignal', 'deviceChange', 'backlog', 'captureGap']) {
      expect(isCopyKey(`void.${v}`), v).toBe(true);
    }
  });

  it('has the verdict strings from 04 section 10.2', () => {
    for (const v of [
      'right',
      'early',
      'late',
      'sharp',
      'flat',
      'wrongNote',
      'wrongOctave',
      'missed',
      'extraNote',
      'replayed',
      'heldTooShort',
    ]) {
      expect(isCopyKey(`verdict.${v}`), v).toBe(true);
    }
  });

  it('has an instrument abbreviation for every launch instrument and every beta instrument in config/instruments.json', () => {
    const ids = [
      'voice-soprano', 'voice-alto', 'voice-tenor', 'voice-bass', 'flute', 'clarinet-bb', 'sax-alto', 'trumpet-bb',
      'violin', 'cello', 'piano-rh', 'sax-tenor', 'sax-bari', 'oboe', 'bassoon', 'horn-f', 'trombone', 'euphonium-bc',
      'euphonium-tc', 'tuba', 'viola', 'double-bass', 'piano-lh', 'guitar',
    ];
    for (const id of ids) expect(isCopyKey(`instrument.abbr.${id}`), id).toBe(true);
  });

  it('keeps 10.2 key names where the spec gives them', () => {
    for (const k of [
      'welcome.headline',
      'welcome.body',
      'calibrate.intro',
      'scan.cover',
      'scan.ranked.notice',
      'scan.startingIn',
      'scan.practice.timeUp',
      'play.status.bar',
      'results.scoring',
      'results.rejudged',
      'results.rejudged.why',
      'credit.line',
      'credit.work',
      'credit.workOnly',
      'credit.source',
      'credit.that-was',
      'credit.adapted',
      'rankup.headline',
      'streak.atRisk',
      'results.practice.tooltip',
    ] as const) {
      expect(isCopyKey(k), k).toBe(true);
    }
  });

  it('places the iOS calibration note and no iOS skip string (PLAN ruling 16)', () => {
    expect(copy('onboarding.calibration.iosNote')).toBe('On iPhone and iPad, takes earn XP only after this check.');
    expect(copyKeys.some((k) => k.includes('skip') && k.toLowerCase().includes('calibrat'))).toBe(false);
  });

  it('keeps the CC BY credit line in the take (PLAN ruling 26)', () => {
    expect(copy('credit.source', { encoder: 'E', corpus: 'C' })).toMatch(/· CC BY 4\.0$/);
  });
});
