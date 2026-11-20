/**
 * Which sample set plays each instrument (round 2, 02-sounds.md "Files and note sets"; 06-plan.md section 4).
 *
 * A static table, so the sound of an instrument is known without fetching `public/sounds/index.json`; a test checks
 * it against that manifest's `instruments` map and against `config/instruments.json`. Voices use the formant sets
 * (`voice-<type>`), never the choir (round 2 decision 4). Euphonium has no free samples and stands in with the
 * trombone set; `standIn` names the instrument whose sound is heard, so the picker can say so.
 */
import type { SoundSetId } from '../core/platform.ts';

/** An instrument id from config/instruments.json. */
export type InstrumentId = string;

export interface SoundSetChoice {
  set: SoundSetId;
  /** The instrument whose samples stand in, or null when the set is the instrument's own. */
  standIn: InstrumentId | null;
}

const SETS: Readonly<Record<InstrumentId, SoundSetChoice>> = {
  'voice-soprano': { set: 'voice-soprano', standIn: null },
  'voice-mezzo': { set: 'voice-mezzo', standIn: null },
  'voice-alto': { set: 'voice-alto', standIn: null },
  'voice-tenor': { set: 'voice-tenor', standIn: null },
  'voice-baritone': { set: 'voice-baritone', standIn: null },
  'voice-bass': { set: 'voice-bass', standIn: null },
  flute: { set: 'flute', standIn: null },
  'clarinet-bb': { set: 'clarinet', standIn: null },
  'sax-alto': { set: 'sax-alto', standIn: null },
  'trumpet-bb': { set: 'trumpet', standIn: null },
  violin: { set: 'violin', standIn: null },
  cello: { set: 'cello', standIn: null },
  'piano-rh': { set: 'piano', standIn: null },
  'piano-lh': { set: 'piano', standIn: null },
  'sax-tenor': { set: 'sax-tenor', standIn: null },
  'sax-bari': { set: 'sax-bari', standIn: null },
  oboe: { set: 'oboe', standIn: null },
  bassoon: { set: 'bassoon', standIn: null },
  'horn-f': { set: 'horn', standIn: null },
  trombone: { set: 'trombone', standIn: null },
  'euphonium-bc': { set: 'trombone', standIn: 'trombone' },
  'euphonium-tc': { set: 'trombone', standIn: 'trombone' },
  tuba: { set: 'tuba', standIn: null },
  viola: { set: 'viola', standIn: null },
  'double-bass': { set: 'double-bass', standIn: null },
  guitar: { set: 'guitar', standIn: null },
};

/** Every set id, checked against the `SoundSetId` union at compile time and against the manifest in a test. */
const SET_IDS = {
  flute: true, clarinet: true, 'sax-alto': true, trumpet: true, violin: true, cello: true, piano: true,
  'voice-soprano': true, 'voice-mezzo': true, 'voice-alto': true, 'voice-tenor': true, 'voice-baritone': true, 'voice-bass': true,
  'sax-tenor': true, 'sax-bari': true, oboe: true, bassoon: true, horn: true, trombone: true, tuba: true, viola: true,
  'double-bass': true, guitar: true, 'choir-aah': true,
} as const satisfies Record<SoundSetId, true>;
export const SOUND_SET_IDS = Object.keys(SET_IDS) as SoundSetId[];

/** Every instrument id the table covers, in config order. */
export const SOUND_SET_INSTRUMENTS: readonly InstrumentId[] = Object.keys(SETS);

/** True when the table has a set for the instrument. */
export function hasSoundSet(instrumentId: InstrumentId): boolean {
  return Object.prototype.hasOwnProperty.call(SETS, instrumentId);
}

/**
 * The set for an instrument. Throws on an id config/instruments.json does not have, as `getInstrument` does; a test
 * keeps the table and the config in step.
 */
export function soundSetFor(instrumentId: InstrumentId): SoundSetChoice {
  if (!hasSoundSet(instrumentId)) throw new RangeError(`no sound set for instrument ${instrumentId}`);
  return SETS[instrumentId] as SoundSetChoice;
}
