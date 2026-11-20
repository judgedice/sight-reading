// Node side of the Listen render spec (listen-render.spec.ts): the shipped corpus (public/corpus/v1) prepared the way
// the session prepares it (selectAndPrepare with the player's settings and a seed), then the session's own Listen
// plan (planListen over listenSourceOf) in concert pitch, and the instrument's sample set. Compiled with esbuild for
// Node (JSON imports inlined) by the spec.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PracticeSettings } from '../../src/core/types.ts';
import { createRng } from '../../src/core/rng.ts';
import { loadExcerpt, loadManifest, selectAndPrepare } from '../../src/corpus/index.ts';
import { soundSetFor } from '../../src/instruments/sound-sets.ts';
import { appConfigs } from '../../src/app/compose/configs.ts';
import { listenSourceOf, planBars, planListen } from '../../src/session/listen-plan.ts';

export interface ListenCaseNote {
  idx: number;
  written: string;
  concertMidi: number;
  hz: number;
  startSec: number;
  durSec: number;
}

export interface ListenCase {
  name: string;
  instrumentId: string;
  excerptId: string;
  set: string;
  bpm: number;
  /** Seconds the render lasts. */
  endSec: number;
  notes: ListenCaseNote[];
}

export interface CaseSpec {
  name: string;
  instrumentId: string;
  /** The excerpt the seed must give (a check that the case is the one meant). */
  excerptId?: string;
  bpm: number;
  meter?: string;
  level?: number;
  seed?: number;
  /** "Hear bars" from..to instead of the whole Listen. */
  bars?: [number, number];
}

const ROOT = process.cwd();
const assets = { getJson: async <T>(p: string): Promise<T> => JSON.parse(readFileSync(join(ROOT, 'public', p), 'utf8')) as T };

const pitchName = (p: { step: string; alter: number; octave: number }): string => `${p.step}${p.alter === 1 ? '#' : p.alter === -1 ? 'b' : ''}${p.octave}`;

export async function listenCases(specs: readonly CaseSpec[]): Promise<ListenCase[]> {
  const cfg = appConfigs();
  const manifest = await loadManifest(assets);
  const out: ListenCase[] = [];
  for (const c of specs) {
    const settings: PracticeSettings = {
      instrumentId: c.instrumentId,
      level: c.level ?? 1,
      writtenKey: 'random',
      meter: c.meter ?? 'random',
      bpm: c.bpm,
      bars: 'random',
      mode: 'practice',
      listening: true,
      metronome: 'audible',
      clickTimbre: 'tick',
      accentFirstBeat: true,
      outputMode: 'speakers',
      a4Hz: 440,
      seed: c.seed ?? 1,
    };
    const history = { seenGroups: {}, recentExcerptIds: [], recentWorks: [], recentWrittenKeys: [], playerLevel: c.level ?? 1 };
    const r = await selectAndPrepare(manifest, settings, history, cfg, createRng(7), (id) => loadExcerpt(manifest, id, assets));
    if ('error' in r) throw new Error(`${c.name}: no excerpt`);
    const prepared = r.prepared;
    if (c.excerptId && prepared.excerptId !== c.excerptId) throw new Error(`${c.name}: got ${prepared.excerptId}, wanted ${c.excerptId}`);
    const src = listenSourceOf(prepared, cfg);
    const facts = { bpm: c.bpm, a4Hz: 440, accent: true };
    const plan = c.bars ? planBars(src, facts, c.bars[0], c.bars[1]) : planListen(src, facts);
    const byIdx = new Map(src.expected.map((e) => [e.idx, e]));
    out.push({
      name: c.name,
      instrumentId: c.instrumentId,
      excerptId: prepared.excerptId,
      set: soundSetFor(c.instrumentId).set,
      bpm: plan.bpm,
      endSec: plan.endSec,
      notes: plan.notes.map((n) => {
        const e = byIdx.get(n.idx) as { writtenPitch?: { step: string; alter: number; octave: number } } | undefined;
        return { idx: n.idx, written: e?.writtenPitch ? pitchName(e.writtenPitch) : '', concertMidi: n.concertMidi, hz: n.hz, startSec: n.startSec, durSec: n.durSec };
      }),
    });
  }
  return out;
}
