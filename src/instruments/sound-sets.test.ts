import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import instrumentsJson from '../../config/instruments.json';
import { hasSoundSet, SOUND_SET_IDS, SOUND_SET_INSTRUMENTS, soundSetFor } from './sound-sets.ts';

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../public/sounds/index.json', import.meta.url)), 'utf8')) as {
  sets: Record<string, unknown>;
  instruments: Record<string, { set: string; substitute?: string }>;
  alternates: Record<string, string>;
};
const ids = (instrumentsJson as { instruments: { id: string; family: string }[] }).instruments;

describe('soundSetFor', () => {
  it('covers every instrument in config/instruments.json, and nothing else', () => {
    for (const i of ids) expect(hasSoundSet(i.id), i.id).toBe(true);
    expect([...SOUND_SET_INSTRUMENTS].sort()).toEqual(ids.map((i) => i.id).sort());
  });

  it("matches the manifest's instruments map, and every set it names exists in the manifest", () => {
    expect(Object.keys(manifest.instruments).sort()).toEqual([...SOUND_SET_INSTRUMENTS].sort());
    for (const id of SOUND_SET_INSTRUMENTS) {
      const choice = soundSetFor(id);
      expect(choice.set, id).toBe(manifest.instruments[id]?.set);
      expect(Object.keys(manifest.sets), id).toContain(choice.set);
      // A stand-in is named exactly where the manifest records a substitute.
      expect(choice.standIn !== null, id).toBe(manifest.instruments[id]?.substitute !== undefined);
    }
  });

  it('gives every voice its own formant set, never the choir', () => {
    const voices = ids.filter((i) => i.family === 'voice');
    expect(voices.length).toBe(6);
    for (const v of voices) {
      const choice = soundSetFor(v.id);
      expect(choice.set).toBe(v.id);
      expect(choice.set).toMatch(/^voice-/);
      expect(choice.set).not.toBe(manifest.alternates.voice);
      expect(choice.standIn).toBeNull();
    }
    expect(SOUND_SET_INSTRUMENTS.map((id) => soundSetFor(id).set)).not.toContain('choir-aah');
  });

  it('plays euphonium with the trombone set, and says so', () => {
    expect(soundSetFor('euphonium-bc')).toEqual({ set: 'trombone', standIn: 'trombone' });
    expect(soundSetFor('euphonium-tc')).toEqual({ set: 'trombone', standIn: 'trombone' });
    expect(soundSetFor('trombone')).toEqual({ set: 'trombone', standIn: null });
  });

  it('names exactly the sets in the manifest', () => {
    expect([...SOUND_SET_IDS].sort()).toEqual(Object.keys(manifest.sets).sort());
  });

  it('throws on an unknown id, as getInstrument does', () => {
    expect(() => soundSetFor('kazoo')).toThrow(RangeError);
    expect(hasSoundSet('toString')).toBe(false);
  });
});
