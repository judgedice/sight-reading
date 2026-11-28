/**
 * The sound manifest, `public/sounds/index.json` (round 2, 02-sounds.md "Files and note sets"). Read once, on the
 * first use of any instrument sound, and checked here so a malformed or partial file falls back to the additive
 * Listen voice instead of throwing in the middle of a playback.
 *
 * MIDI numbers are sounding pitch. `tune` is the sample's measured offset from its MIDI note, in cents. `onset`,
 * `loopStart` and `loopEnd` are seconds from the first decoded sample of the encoded file.
 */

/** One sample file of a set. */
export interface SampleDef {
  /** File name inside the set folder, for example `Ds3.mp3`. */
  file: string;
  /** Nominal sounding MIDI note. */
  midi: number;
  /** Measured offset from `midi`, cents (0 when absent). */
  tune: number;
  /** Where the sound starts in the encoder's output, seconds (0 when absent). */
  onset: number;
  /** Loop points for sustained sets, seconds; absent on one-shots. */
  loopStart?: number;
  loopEnd?: number;
}

/**
 * How a set plays: `sustain` loops between the loop points, so notes of any length hold; `decay` (piano, guitar) plays
 * through once and stops.
 */
export type SetKind = 'sustain' | 'decay';

export interface SetDef {
  kind: SetKind;
  /** Sounding range the set is meant for, [lowest, highest] MIDI. */
  range: [number, number];
  /** Linear rise, seconds. */
  attack: number;
  /** Linear fall after the note's end, seconds. */
  release: number;
  /** Ascending by `midi`. */
  samples: SampleDef[];
}

export interface SoundManifest {
  version: number;
  sets: Record<string, SetDef>;
  /** App instrument id to set folder. */
  instruments: Record<string, { set: string; substitute?: string }>;
  /** Comparison sets that no instrument uses by default (for example `voice: 'choir-aah'`). */
  alternates: Record<string, string>;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function parseSample(x: unknown, where: string): SampleDef {
  if (!isObj(x) || typeof x.file !== 'string' || x.file === '' || !num(x.midi)) throw new Error(`${where}: a sample needs file and midi`);
  if (/[/\\]|\.\./.test(x.file)) throw new Error(`${where}: sample file ${x.file} leaves the set folder`);
  const s: SampleDef = { file: x.file, midi: x.midi, tune: num(x.tune) ? x.tune : 0, onset: num(x.onset) ? Math.max(0, x.onset) : 0 };
  if (num(x.loopStart) && num(x.loopEnd) && x.loopEnd > x.loopStart && x.loopStart >= 0) {
    s.loopStart = x.loopStart;
    s.loopEnd = x.loopEnd;
  }
  return s;
}

function parseSet(id: string, x: unknown): SetDef {
  const where = `sounds/${id}`;
  if (!isObj(x)) throw new Error(`${where}: not an object`);
  if (x.kind !== 'sustain' && x.kind !== 'decay') throw new Error(`${where}: unknown kind ${String(x.kind)}`);
  if (!Array.isArray(x.samples) || x.samples.length === 0) throw new Error(`${where}: no samples`);
  const samples = x.samples.map((s) => parseSample(s, where)).sort((a, b) => a.midi - b.midi);
  const r = Array.isArray(x.range) && num(x.range[0]) && num(x.range[1]) ? ([x.range[0], x.range[1]] as [number, number]) : null;
  const first = samples[0] as SampleDef;
  const last = samples[samples.length - 1] as SampleDef;
  return {
    kind: x.kind,
    range: r ?? [first.midi, last.midi],
    attack: num(x.attack) && x.attack >= 0 ? x.attack : 0.02,
    release: num(x.release) && x.release >= 0 ? x.release : 0.2,
    samples,
  };
}

/** Checks `index.json`. Throws on a file the sampler cannot use; ignores fields it does not need. */
export function parseSoundManifest(json: unknown): SoundManifest {
  if (!isObj(json) || !isObj(json.sets)) throw new Error('sounds/index.json: no sets');
  const sets: Record<string, SetDef> = {};
  for (const [id, def] of Object.entries(json.sets)) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`sounds/index.json: bad set id ${id}`);
    sets[id] = parseSet(id, def);
  }
  const instruments: SoundManifest['instruments'] = {};
  if (isObj(json.instruments)) {
    for (const [iid, e] of Object.entries(json.instruments)) {
      if (isObj(e) && typeof e.set === 'string') instruments[iid] = typeof e.substitute === 'string' ? { set: e.set, substitute: e.substitute } : { set: e.set };
    }
  }
  const alternates: Record<string, string> = {};
  if (isObj(json.alternates)) for (const [k, v] of Object.entries(json.alternates)) if (typeof v === 'string') alternates[k] = v;
  return { version: num(json.version) ? json.version : 1, sets, instruments, alternates };
}
