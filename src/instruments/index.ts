/**
 * `instruments/` (01 §4.1, §5; 02 §1): typed lookups over config/instruments.json via `Configs`.
 * Reads only `Configs`; no tolerance or detection constants live here.
 */
import type { InstrumentsApi } from '../core/api.ts';
import type { Clef, Configs, Family, Instrument, TierId } from '../core/types.ts';

const TIERS: readonly TierId[] = ['A', 'B', 'C', 'D', 'E'];
const MAX_LEVEL = 10;

/** 02 §1.4: two levels per tier, L1-2 A through L9-10 E. */
export const tierForLevel: InstrumentsApi['tierForLevel'] = (level) => {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new RangeError(`no level ${level}`);
  return TIERS[Math.ceil(level / 2) - 1]!;
};

export const getInstrument: InstrumentsApi['getInstrument'] = (cfg, id) => {
  const inst = cfg.instrumentById[id];
  if (!inst) throw new RangeError(`unknown instrument ${id}`);
  return inst;
};

/** Config order; beta instruments only when asked. */
export const listInstruments: InstrumentsApi['listInstruments'] = (cfg, opts) =>
  cfg.instruments.instruments.filter((i) => opts.includeBeta || i.status === 'launch');

export const bandFor: InstrumentsApi['bandFor'] = (inst, level) => {
  const [lo, hi] = inst.tiers[tierForLevel(level)];
  return [lo, hi];
};

export const clefsAt: InstrumentsApi['clefsAt'] = (inst, level) =>
  inst.clefs.filter((c) => c.fromLevel <= level).map((c) => c.clef);

export const launchInstruments = (cfg: Configs): Instrument[] => listInstruments(cfg, { includeBeta: false });
export const betaInstruments = (cfg: Configs): Instrument[] => cfg.instruments.instruments.filter((i) => i.status === 'beta');
export const isBeta = (inst: Instrument): boolean => inst.status === 'beta';

/** Detection range as [minHz, maxHz] (01 §7.3). */
export const detectionRange = (inst: Instrument): [number, number] => [inst.detection.minHz, inst.detection.maxHz];

export const isVoice = (inst: Instrument): boolean => inst.family === 'voice';
/** The voice instruments (soprano, alto, tenor, bass...). */
export const voiceTypes = (cfg: Configs): Instrument[] => cfg.instruments.instruments.filter(isVoice);
export const byFamily = (cfg: Configs, family: Family): Instrument[] =>
  cfg.instruments.instruments.filter((i) => i.family === family);

/** Primary clef: the first entry (02 §1.3). */
export const primaryClef = (inst: Instrument): Clef => inst.clefs[0]?.clef ?? 'treble';

/** Written minus sounding, chromatic semitones (02 §1.3). Positive: sounds lower than written. */
export const transposition = (inst: Instrument): { diatonic: number; chromatic: number } => ({
  diatonic: inst.writtenMinusSounding.diatonic,
  chromatic: inst.writtenMinusSounding.chromatic,
});

export const isTransposing = (inst: Instrument): boolean => inst.writtenMinusSounding.chromatic !== 0;

/** Written MIDI to concert (sounding) MIDI. */
export const writtenToConcert = (inst: Instrument, written: number): number => written - inst.writtenMinusSounding.chromatic;
export const concertToWritten = (inst: Instrument, concert: number): number => concert + inst.writtenMinusSounding.chromatic;

export const instrumentsApi: InstrumentsApi = { getInstrument, listInstruments, tierForLevel, bandFor, clefsAt };
