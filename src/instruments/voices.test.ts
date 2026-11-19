// The mezzo-soprano and baritone voice types (05 section 6.5, PLAN ruling 57).
import { describe, expect, it } from 'vitest';
import { loadManifest, countEligible } from '../corpus/index.ts';
import { configs } from '../../fixtures/follow/gen/io.ts';
import { diskAssets } from '../../tools/corpus-check/check.ts';
import { PitchDetector, freqToMidi, widenRange } from '../dsp/pitch.ts';
import { PhaseDecimator, TARGET_RATE } from '../dsp/decimator.ts';
import { renderPerformance } from '../testkit/synth/index.ts';
import { exportAll, importAll } from '../store/export-import.ts';
import { MemoryKv, makeProfile, memoryRepos } from '../store/test-data.ts';
import { getInstrument, launchInstruments, voiceTypes } from './index.ts';

const cfg = configs();
const ORDER = ['voice-soprano', 'voice-mezzo', 'voice-alto', 'voice-tenor', 'voice-baritone', 'voice-bass'];

describe('voice types', () => {
  it('lists six launch voices in singing order', () => {
    expect(voiceTypes(cfg).map((v) => v.id)).toEqual(ORDER);
    expect(launchInstruments(cfg).filter((i) => i.family === 'voice').map((i) => i.id)).toEqual(ORDER);
  });

  it('gives mezzo and baritone the 05 section 6.5 values', () => {
    const mezzo = getInstrument(cfg, 'voice-mezzo');
    const bari = getInstrument(cfg, 'voice-baritone');
    for (const v of [mezzo, bari]) {
      expect(v).toMatchObject({ family: 'voice', relativePitch: true, pitchKind: 'continuous', onsetClass: 'soft', testkitTimbre: 'voice', semis: 0 });
      expect(v.writtenMinusSounding).toEqual({ diatonic: 0, chromatic: 0 });
    }
    expect(mezzo.clefs).toEqual([{ clef: 'treble', fromLevel: 1 }]);
    expect(bari.clefs).toEqual([{ clef: 'bass', fromLevel: 1 }]);
    expect(mezzo.fullWrittenRange).toEqual([55, 81]);
    expect(Object.values(mezzo.tiers)).toEqual([[60, 72], [59, 74], [57, 77], [55, 79], [55, 81]]);
    expect(bari.fullWrittenRange).toEqual([43, 67]);
    expect(Object.values(bari.tiers)).toEqual([[48, 60], [45, 62], [43, 64], [43, 65], [43, 67]]);
  });

  it('copies detection from the neighbour and sets the range to the sounding range plus a whole tone', () => {
    const { minHz: _a, maxHz: _b, ...alto } = getInstrument(cfg, 'voice-alto').detection;
    const { minHz: _c, maxHz: _d, ...bass } = getInstrument(cfg, 'voice-bass').detection;
    const mezzo = getInstrument(cfg, 'voice-mezzo').detection;
    const bari = getInstrument(cfg, 'voice-baritone').detection;
    expect({ ...mezzo, minHz: undefined, maxHz: undefined }).toEqual({ ...alto, minHz: undefined, maxHz: undefined });
    expect({ ...bari, minHz: undefined, maxHz: undefined }).toEqual({ ...bass, minHz: undefined, maxHz: undefined });
    expect(mezzo.minHz).toBeCloseTo(174.6, 1);
    expect(mezzo.maxHz).toBeCloseTo(987.8, 1);
    expect(bari.minHz).toBeCloseTo(87.3, 1);
    expect(bari.maxHz).toBeCloseTo(440, 0);
  });

  it.each(['voice-mezzo', 'voice-baritone'])('%s detection finds the pitch at the bottom and top of the range', (id) => {
    const inst = getInstrument(cfg, id);
    const { windowSamples, minHz, maxHz } = inst.detection;
    const w = widenRange(minHz, maxHz);
    const det = new PitchDetector({ analysisRate: TARGET_RATE, windowSamples: windowSamples as 512 | 1024, minHz: w.minHz, maxHz: w.maxHz });
    for (const midi of inst.fullWrittenRange) {
      const dry = renderPerformance({ timbre: inst.testkitTimbre ?? 'voice', sampleRate: 48000, notes: [{ midi, onsetSec: 0.1, durSec: 1.2 }], vibrato: null, durationSec: 1.6 });
      const dec = new PhaseDecimator(48000);
      const out = new Float32Array(Math.ceil(dry.samples.length / dec.factor) + 8);
      const n = dec.process(dry.samples, out, 0);
      const mid = Math.round(n / 2);
      const r = det.detect(out.subarray(mid, mid + windowSamples));
      expect(Math.abs(freqToMidi(r.freq) - midi), `${id} midi ${midi} got ${r.freq} Hz`).toBeLessThan(0.1);
      expect(r.clarity).toBeGreaterThanOrEqual(inst.detection.clarityThreshold);
    }
  });

  it('serves music at every difficulty from the shipped corpus', async () => {
    const m = await loadManifest(diskAssets());
    for (const id of ['voice-mezzo', 'voice-baritone']) {
      for (let level = 1; level <= 10; level++) {
        const meters = cfg.levels.levels[level - 1]!.meters;
        const total = meters.reduce((s, meter) => s + countEligible(m, id, level, meter, cfg), 0);
        expect(total, `${id} difficulty ${level}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps a stored voice-bass choice through export and import', async () => {
    const kv = new MemoryKv();
    const r = memoryRepos(kv);
    const base = makeProfile();
    await r.profile.put({ ...base, instruments: { ...base.instruments, 'voice-bass': base.instruments.flute! } });
    const file = await exportAll(r, kv);
    const kv2 = new MemoryKv();
    const r2 = memoryRepos(kv2);
    await importAll(r2, JSON.parse(JSON.stringify(file)), kv2);
    const back = await r2.profile.get();
    expect(Object.keys(back?.instruments ?? {})).toContain('voice-bass');
    expect(getInstrument(cfg, 'voice-bass').tiers.A).toEqual([45, 57]);
    expect(getInstrument(cfg, 'voice-bass').fullWrittenRange).toEqual([40, 65]);
  });
});
