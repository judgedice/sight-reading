/** The four sounds of the read-through (05 section 8.8). */
export type SoundId = 'listen' | 'tempo' | 'reference' | 'tuning';

/** Voices hear the key chord and then their first note; instruments hear the key chord only (05 section 10). */
export type ReferenceKind = 'voice' | 'instrument';

/** A tempo marking as the setup controls draw it: the beat unit character and the beats per minute. */
export interface TempoValue {
  unit: string;
  bpm: number;
}

/** What the sounds group, the dock and the explain sheet need to know. The screen owns the state. */
export interface SoundsModel {
  /** `voice` gives "Hear starting pitch"; `instrument` gives "Hear the key". */
  reference: ReferenceKind;
  /** A ranked take: "Listen first" carries "Makes this practice". */
  ranked: boolean;
  tempo: TempoValue;
  /** Winds, brass and strings only, and only with the microphone allowed. */
  tuning: boolean;
  /** Seconds to hold a note (`grading.tuning.captureSec`). */
  tuningSeconds: number;
  /** The sound that is playing now, if any. One at a time. */
  playing: SoundId | null;
  /** Sounds that cannot start now (for example audio is unavailable). They stay focusable. */
  disabled?: Readonly<Partial<Record<SoundId, boolean>>>;
}
