import { describe, expect, it } from 'vitest';
import { makeAttempt } from '../../../store/test-data.ts';
import { summarizeAttempt } from '../../../store/summary.ts';
import { attemptTitle, metaLine, metaParts, rowDetail, servedMeter, dayLabel, filterQuery, groupByDay, localDayOf, matchesFilter, parseFilter, shiftDay } from './model.ts';

describe('filter query', () => {
  it('round-trips instrument and ranked through the URL query', () => {
    const f = parseFilter('#/history?instrument=trumpet-bb&ranked=1');
    expect(f).toEqual({ instrumentId: 'trumpet-bb', rankedOnly: true, excerptId: null });
    expect(filterQuery(f)).toBe('?instrument=trumpet-bb&ranked=1');
  });

  it('is empty when nothing is set and ignores unknown parameters', () => {
    expect(parseFilter('#/history')).toEqual({ instrumentId: null, rankedOnly: false, excerptId: null });
    expect(parseFilter('#/history?ranked=0&x=1')).toEqual({ instrumentId: null, rankedOnly: false, excerptId: null });
    expect(filterQuery({ instrumentId: null, rankedOnly: false })).toBe('');
  });

  it('filters rows by instrument and by ranked', () => {
    const a = summarizeAttempt(makeAttempt(0, { instrumentId: 'flute' }));
    const b = summarizeAttempt(makeAttempt(1, { instrumentId: 'violin' }));
    expect(matchesFilter(a, { instrumentId: 'flute', rankedOnly: false })).toBe(true);
    expect(matchesFilter(b, { instrumentId: 'flute', rankedOnly: false })).toBe(false);
    expect(matchesFilter({ ...a, ranked: false }, { instrumentId: null, rankedOnly: true })).toBe(false);
  });
});

describe('local days', () => {
  it('groups consecutive rows by the device day, newest first', () => {
    const rows = [
      { id: 'a', createdAt: '2026-02-03T10:00:00.000Z' },
      { id: 'b', createdAt: '2026-02-03T09:00:00.000Z' },
      { id: 'c', createdAt: '2026-02-01T09:00:00.000Z' },
    ].map((r) => ({ ...summarizeAttempt(makeAttempt(0)), ...r }));
    const groups = groupByDay(rows);
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([['a', 'b'], ['c']]);
    expect(groups[0]?.day).toBe(localDayOf('2026-02-03T10:00:00.000Z'));
  });

  it('shifts a day by whole calendar days', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('labels today and yesterday, and otherwise weekday, day and month', () => {
    expect(dayLabel('2026-11-18', '2026-11-18')).toBe('Today');
    expect(dayLabel('2026-11-17', '2026-11-18')).toBe('Yesterday');
    expect(dayLabel('2026-11-16', '2026-11-18')).toBe('Mon 16 Nov');
  });
});

describe('row and detail summary', () => {
  const rec = (meter: string, bpm = 71) => makeAttempt(0, { bpm, settingsResolved: { ...makeAttempt(0).settingsResolved, meter } });

  it('reads "Baritone voice · Difficulty 2 · C major · 4/4 · ♩ = 71"', () => {
    const r = rec('4/4');
    const line = metaLine(metaParts('Baritone voice', 2, rowDetail(r)));
    expect(line).toBe('Baritone voice · Difficulty 2 · C major · 4/4 · ♩ = 71');
  });

  it('uses the dotted quarter for a compound meter', () => {
    expect(metaLine(metaParts('Flute', 3, rowDetail(rec('6/8', 60))))).toBe('Flute · Difficulty 3 · C major · 6/8 · ♩. = 60');
  });

  it('never says random: the served meter comes from the excerpt, and is left out when unknown', () => {
    const r = rec('random');
    expect(servedMeter(r)).toBeNull();
    expect(servedMeter(r, { meter: { beats: 3, beatType: 4 } })).toBe('3/4');
    expect(metaLine(metaParts('Flute', 1, rowDetail(r)))).toBe('Flute · Difficulty 1 · C major · ♩ = 71');
    expect(metaLine(metaParts('Flute', 1, rowDetail(r, { meter: { beats: 3, beatType: 4 } })))).toBe('Flute · Difficulty 1 · C major · 3/4 · ♩ = 71');
  });

  it('titles a take with its work and movement', () => {
    const r = makeAttempt(0);
    expect(attemptTitle({ credit: { ...r.credit, work: 'Sonata', movement: 'Allegro' } })).toBe('Sonata: Allegro');
    expect(attemptTitle({ credit: { ...r.credit, work: 'Sonata', movement: undefined as never } })).toBe('Sonata');
  });
});
