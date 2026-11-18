// @vitest-environment jsdom
// C10: the checker's own logic, then the shipped corpus. Run with `pnpm vitest run tools/corpus-check`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExcerptDoc, ManifestEntry } from '../../src/core/types.ts';
import { loadExcerpt, loadManifest } from '../../src/corpus/index.ts';
import { computeFit, diskAssets, fingerprint, fittingKeys, readConfigs, runCheck, MIN_EXCERPTS } from './check.ts';

const DENYLIST = resolve(import.meta.dirname, '../corpus-build/denylist.yaml');
const denied = (): Set<string> => new Set([...readFileSync(DENYLIST, 'utf8').matchAll(/^\s*- id: (\S+)/gm)].map((m) => m[1]!));

describe('fit and fingerprint helpers', () => {
  const cfg = readConfigs();
  const entry = (over: Partial<ManifestEntry>): ManifestEntry => ({ level: 4, mode: 'major', modal: null, fifths: 0, rangeConcert: [67, 79], ...over }) as ManifestEntry;

  it('fits a mid-range line in many keys and a huge span in none', () => {
    const flute = cfg.instruments.instruments.find((i) => i.id === 'flute')!;
    expect(fittingKeys(entry({}), flute, cfg).length).toBeGreaterThan(3);
    expect(fittingKeys(entry({ rangeConcert: [40, 100] }), flute, cfg)).toEqual([]);
  });

  it('serves a modal excerpt only under a random key, and only where the level allows the mode', () => {
    const violin = cfg.instruments.instruments.find((i) => i.id === 'violin')!;
    const r = fittingKeys(entry({ level: 8, modal: 'dorian', mode: 'minor' }), violin, cfg);
    expect(r.every((k) => k === 'random')).toBe(true);
  });

  it('computeFit counts an entry once per level and meter for each instrument it fits', () => {
    const e = entry({ meter: '4/4' });
    const fit = computeFit([e, { ...e, id: 'b' }], cfg);
    expect(fit.flute?.[4]?.['4/4']).toBe(2);
  });

  it('a fingerprint ignores transposition and augmentation', async () => {
    const assets = diskAssets();
    const m = await loadManifest(assets);
    const doc = await loadExcerpt(m, m.entries[5]!.id, assets);
    const shifted: ExcerptDoc = JSON.parse(JSON.stringify(doc)) as ExcerptDoc;
    for (const meas of shifted.measures) {
      meas.startTick *= 2;
      for (const ev of meas.events) {
        ev.tick *= 2;
        ev.dur *= 2;
        if (ev.kind === 'note') ev.pitch = { ...ev.pitch, octave: ev.pitch.octave + 1 };
      }
    }
    expect(fingerprint(shifted)).toBe(fingerprint(doc));
    expect(fingerprint(doc).length).toBeGreaterThan(10);
  });
});

describe('shipped corpus (public/corpus/v1)', () => {
  it(
    'passes every gate except for excerpts already on the denylist',
    async () => {
      const r = await runCheck();
      expect(r.excerpts).toBeGreaterThanOrEqual(MIN_EXCERPTS);
      expect(r.fitMismatches).toBe(0);
      const deny = denied();
      const open = r.failures.filter((f) => !deny.has(f.id));
      expect(open, open.map((f) => `${f.gate} ${f.id}: ${f.reason}`).join('\n')).toEqual([]);
      expect(r.rendered).toBeGreaterThan(0);
    },
    300_000,
  );
});
