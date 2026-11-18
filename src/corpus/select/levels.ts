/**
 * Level and instrument lookups the selector needs: tier band, clefs, written keys, tempo range, window class and
 * family groups (02 §1.3, §1.4, §2.3, §2.4, §2.6; 03 §7.2, §7.4 step 6). Reads only `Configs`.
 *
 * `src/instruments/` has no implementation yet, so `bandFor` and `clefsAt` are local here with the
 * `InstrumentsApi` signatures.
 */
import type { Clef, Configs, Family, Instrument, KeySig, LevelDef, Meter, WindowClassKey } from '../../core/types.ts';
import { makeMeter } from '../../core/time.ts';

export function levelDef(cfg: Configs, level: number): LevelDef {
  const def = cfg.levelByNumber[level];
  if (!def) throw new RangeError(`no level ${level} in levels.json`);
  return def;
}

export function getInstrument(cfg: Configs, id: string): Instrument {
  const inst = cfg.instrumentById[id];
  if (!inst) throw new RangeError(`unknown instrument ${id}`);
  return inst;
}

/** Written MIDI band for the level, inclusive (02 §1.4). */
export function bandFor(inst: Instrument, def: LevelDef): [number, number] {
  return inst.tiers[def.tier];
}

/** Clefs allowed at the level, primary first (02 §1.3, §2.3). */
export function clefsAt(inst: Instrument, level: number): Clef[] {
  return inst.clefs.filter((c) => c.fromLevel <= level).map((c) => c.clef);
}

/** Bottom staff line as an absolute diatonic position (octave * 7 + letter index), E4 for treble. */
const STAFF_BOTTOM: Record<Clef, number> = { treble: 30, 'treble-8vb': 30, bass: 18, alto: 24, tenor: 22 };
/** Letter index of each pitch class, sharp spelling (accurate to one ledger line at most). */
const PC_LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const;

function ledgerLines(writtenMidi: number, clef: Clef): number {
  const pos = (Math.floor(writtenMidi / 12) - 1) * 7 + PC_LETTER[((writtenMidi % 12) + 12) % 12]!;
  const bottom = STAFF_BOTTOM[clef];
  if (pos < bottom) return Math.floor((bottom - pos) / 2);
  if (pos > bottom + 8) return Math.floor((pos - bottom - 8) / 2);
  return 0;
}

/**
 * 03 §7.4 step 6: among the clefs allowed at the level, the one with the fewest ledger lines for the written range
 * (the worse extreme first, then the total). Ties go to the primary clef (the earlier entry).
 */
export function chooseClef(inst: Instrument, level: number, writtenRange: readonly [number, number]): Clef {
  const allowed = clefsAt(inst, level);
  let best: { clef: Clef; worst: number; total: number } | null = null;
  for (const clef of allowed) {
    const a = ledgerLines(writtenRange[0], clef);
    const b = ledgerLines(writtenRange[1], clef);
    const cand = { clef, worst: Math.max(a, b), total: a + b };
    if (!best || cand.worst < best.worst || (cand.worst === best.worst && cand.total < best.total)) best = cand;
  }
  return best?.clef ?? inst.clefs[0]?.clef ?? 'treble';
}

export function parseMeter(meter: string): Meter {
  const [beats, beatType] = meter.split('/').map(Number);
  if (!beats || !beatType || ![2, 4, 8, 16].includes(beatType)) throw new RangeError(`bad meter ${meter}`);
  return makeMeter(beats, beatType as Meter['beatType']);
}

/** Compound x/8 meters counted in dotted quarters (02 conventions, `makeMeter`). */
export function isCompound(meter: Meter): boolean {
  return meter.countsPerBar !== meter.beats;
}

/** The level's tempo range; compound meters at `compound.dottedBeatLevels` use the dotted-beat range (02 §2.4). */
export function levelTempo(cfg: Configs, def: LevelDef, meter: Meter): { minBpm: number; maxBpm: number } {
  const [from, to] = cfg.levels.compound.dottedBeatLevels;
  if (isCompound(meter) && def.level >= from && def.level <= to) return { ...cfg.levels.compound.dottedBpm };
  return { ...def.tempo };
}

export function windowClass(inst: Instrument): WindowClassKey {
  return String(inst.detection.windowSamples) as WindowClassKey;
}

const WIND_FAMILIES: readonly Family[] = ['flute', 'double-reed', 'clarinet', 'sax'];
const BRASS_FAMILIES: readonly Family[] = ['high-brass', 'low-brass'];
const STRING_FAMILIES: readonly Family[] = ['upper-strings', 'low-strings'];

export const isWindOrBrass = (inst: Instrument): boolean => WIND_FAMILIES.includes(inst.family) || BRASS_FAMILIES.includes(inst.family);
/** Families the breath rule applies to: winds, brass and voice (02 §2.4, 03 §7.2). */
export const needsBreath = (inst: Instrument): boolean => isWindOrBrass(inst) || inst.family === 'voice';
export const isStrings = (inst: Instrument): boolean => STRING_FAMILIES.includes(inst.family);
/** Concert B♭, E♭ and F instruments (02 §2.6 rule 6): written minus sounding is 2, 9 or 7 semitones mod 12. */
export const isBbEbF = (inst: Instrument): boolean => [2, 7, 9].includes(((inst.writtenMinusSounding.chromatic % 12) + 12) % 12);

/** Same-pitch repeat floor class: voice and bowed are soft, everything else tongued or struck (01 §8.3). */
export const softRepeats = (inst: Instrument): boolean => inst.detection.onsetProfile === 'voice' || inst.detection.onsetProfile === 'bowed';

/** Written keys allowed at the level in one mode (02 §2.3 "Written key"), C-centred order. */
export function allowedWrittenKeys(def: LevelDef, mode: 'major' | 'minor'): KeySig[] {
  if (!def.writtenKeys.modes.includes(mode)) return [];
  const out: KeySig[] = [];
  const max = def.writtenKeys.maxAccidentals;
  for (let f = -max; f <= max; f++) out.push({ fifths: f, mode });
  return out;
}

export function keyAllowed(def: LevelDef, k: KeySig): boolean {
  return Number.isInteger(k.fifths) && Math.abs(k.fifths) <= def.writtenKeys.maxAccidentals && def.writtenKeys.modes.includes(k.mode);
}

export const sameKey = (a: KeySig, b: KeySig): boolean => a.fifths === b.fifths && a.mode === b.mode;
