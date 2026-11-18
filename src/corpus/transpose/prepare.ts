/**
 * `prepareExcerpt` (01 §5.5, §6.3 step 5; 03 §7.4): apply the selection's transposition to the doc. The selector
 * already decided the 03 §7.5 rules from the manifest (PLAN ruling 44); this re-checks them on the doc and throws
 * `TranspositionError` instead of editing notes when the doc and its manifest entry disagree (`selectAndPrepare`
 * then selects again without that excerpt).
 */
import type { CorpusApi } from '../../core/api.ts';
import type { DisplayedModification, PreparedEvent, PreparedMeasure } from '../../core/types.ts';
import { toMidi } from '../../theory/index.ts';
import { bandFor, levelDef } from '../select/levels.ts';
import { bpmPlayable, clippedTempo, type TempoFacts } from '../select/tempo.ts';
import { planTransposition, spellExcerpt, type SpellingVerdict } from './spell.ts';

export type TranspositionErrorCode = Exclude<SpellingVerdict, 'ok'> | 'mismatch' | 'range' | 'tempo';

export class TranspositionError extends Error {
  readonly code: TranspositionErrorCode;
  readonly excerptId: string;
  constructor(code: TranspositionErrorCode, excerptId: string, message: string) {
    super(`${excerptId}: ${message}`);
    this.name = 'TranspositionError';
    this.code = code;
    this.excerptId = excerptId;
  }
}

export const prepareExcerpt: CorpusApi['prepareExcerpt'] = (doc, sel, inst, cfg) => {
  if (doc.id !== sel.entry.id) throw new TranspositionError('mismatch', doc.id, `selection is for ${sel.entry.id}`);
  if (inst.id !== sel.settings.instrumentId) throw new TranspositionError('mismatch', doc.id, `selection is for instrument ${sel.settings.instrumentId}`);
  const def = levelDef(cfg, sel.levelServed);
  const plan = planTransposition(doc.keyConcert, sel.writtenKey, sel.transposition.chromatic, inst);
  const spelled = spellExcerpt(doc, plan, inst, def.doubleAccidentals);
  if (spelled.verdict !== 'ok') throw new TranspositionError(spelled.verdict, doc.id, `spelling in written key ${sel.writtenKey.fifths} ${sel.writtenKey.mode}: ${spelled.verdict}`);

  let lo = Infinity;
  let hi = -Infinity;
  for (const w of spelled.written.values()) {
    const midi = toMidi(w);
    lo = Math.min(lo, midi);
    hi = Math.max(hi, midi);
  }
  const band = bandFor(inst, def);
  if (lo < band[0] || hi > band[1]) throw new TranspositionError('range', doc.id, `written range ${lo}-${hi} outside band ${band[0]}-${band[1]}`);

  const facts: TempoFacts = {
    meter: doc.meter,
    minBpm: doc.tempo.minBpm,
    maxBpm: doc.tempo.maxBpm,
    minIoiTicks: doc.features.minIoiTicks,
    minRepeatIoiTicks: doc.features.minRepeatIoiTicks,
    peakNotesPerBeat: doc.features.peakNotesPerBeat,
  };
  const bpmRange = clippedTempo(facts, inst, def, cfg);
  if (!bpmRange || !bpmPlayable(sel.settings.bpm, facts, inst, def, cfg)) {
    throw new TranspositionError('tempo', doc.id, `no eligible tempo at level ${def.level} for ${inst.id} at ${sel.settings.bpm} bpm`);
  }

  let bar = 1;
  const measures: PreparedMeasure[] = doc.measures.map((m) => ({
    index: m.index,
    isPickup: m.isPickup,
    startTick: m.startTick,
    displayBar: m.isPickup ? 0 : bar++,
    events: m.events.map((e): PreparedEvent => {
      if (e.kind === 'rest') return { ...e };
      const { pitch: _pitch, ...rest } = e;
      return { ...rest, concertPitch: spelled.concert.get(e.id)!, writtenPitch: spelled.written.get(e.id)! };
    }),
  }));

  const modifications: DisplayedModification[] = [...doc.modifications];
  if (plan.concertInterval.chromatic !== 0 || plan.concertInterval.diatonic !== 0) modifications.push('transposed');
  if (sel.octaveDisplaced) modifications.push('octave-displaced');

  return {
    excerptId: doc.id,
    instrumentId: inst.id,
    source: doc.source,
    meter: doc.meter,
    pickupTicks: doc.pickupTicks,
    writtenKey: sel.writtenKey,
    concertKey: plan.concertKey,
    modal: doc.modal,
    clef: sel.clef,
    transposition: plan.concertInterval,
    measures,
    rangeWritten: { min: lo, max: hi },
    modifications,
    barRhythmLevel: doc.barRhythmLevel,
    extremes: doc.extremes,
    dedupeGroup: doc.dedupeGroup,
    levelServed: sel.levelServed,
    stretch: sel.stretch,
    bpmRange,
    selection: sel,
  };
};
