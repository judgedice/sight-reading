/**
 * Full synth (P3, 01 section 13.2): nine timbres, realism conditions, ground truth from core/onset-definition.ts.
 * The minimal renderer in ../synth-min.ts stays as it is (its reference WAVs are frozen); this package builds on it
 * (the click bursts) and adds the rest.
 */
export * from './dsp-util.ts';
export * from './timbres.ts';
export * from './render.ts';
export * from './conditions.ts';
export * from './measure.ts';
