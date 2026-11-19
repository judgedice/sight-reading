// SoundPlayer (05 §8.8, §9.3): one sound at a time, captions on the backend clock, back to idle at the end, and a
// failure shown for six seconds.
import { describe, expect, it } from 'vitest';
import { SOUND_FAILED_MS, SOUND_LEAD_SEC, SoundPlayer } from './sounds.ts';

function setup() {
  let now = 10;
  let stops = 0;
  const pending: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  let wall = 0;
  const timers = {
    setTimeout: (fn: () => void, ms: number) => {
      const id = ++ids;
      pending.push({ at: wall + ms, fn, id });
      return id;
    },
    clearTimeout: (h: unknown) => {
      const i = pending.findIndex((p) => p.id === h);
      if (i >= 0) pending.splice(i, 1);
    },
  };
  /** Moves wall time and the audio clock together, firing due timers in order. */
  const advance = (sec: number): void => {
    const end = wall + sec * 1000;
    for (;;) {
      pending.sort((a, b) => a.at - b.at);
      const next = pending[0];
      if (!next || next.at > end) break;
      pending.shift();
      now += (next.at - wall) / 1000;
      wall = next.at;
      next.fn();
    }
    now += (end - wall) / 1000;
    wall = end;
  };
  const player = new SoundPlayer({ now: () => now as never, stopSounds: () => void stops++ }, timers);
  return { player, advance, stops: () => stops, now: () => now };
}

describe('SoundPlayer', () => {
  it('follows the segments on the clock and goes idle at the end', async () => {
    const t = setup();
    let origin = 0;
    await t.player.play({
      kind: 'listen',
      durSec: 3,
      segments: [
        { atSec: 0, caption: { kind: 'lead-in', bpm: 120 } },
        { atSec: 1, caption: { kind: 'bar', bar: 1, of: 2 }, bar: 1 },
        { atSec: 2, caption: { kind: 'bar', bar: 2, of: 2 }, bar: 2 },
      ],
      fromBar: 1,
      schedule: async (o) => {
        origin = o;
      },
    });
    expect(origin).toBeCloseTo(10 + SOUND_LEAD_SEC, 9);
    expect(t.player.view.getState()).toMatchObject({ playing: 'listen', caption: { kind: 'lead-in', bpm: 120 }, bar: null, fromBar: 1 });
    t.advance(1.1);
    expect(t.player.view.getState()).toMatchObject({ caption: { kind: 'bar', bar: 1, of: 2 }, bar: 1 });
    t.advance(1);
    expect(t.player.view.getState().bar).toBe(2);
    t.advance(1);
    expect(t.player.view.getState()).toMatchObject({ playing: null, caption: null, bar: null });
  });

  it('starting a sound stops the one playing; stop clears it', async () => {
    const t = setup();
    const schedule = async (): Promise<void> => undefined;
    await t.player.play({ kind: 'tempo', durSec: 2, segments: [{ atSec: 0, caption: { kind: 'tempo', bpm: 60 } }], schedule });
    await t.player.play({ kind: 'note', durSec: 1, segments: [{ atSec: 0, caption: { kind: 'note', midi: 60 } }], schedule });
    expect(t.stops()).toBe(2);
    expect(t.player.view.getState().playing).toBe('note');
    t.advance(0.5);
    expect(t.player.view.getState().playing).toBe('note');
    t.player.stop();
    expect(t.stops()).toBe(3);
    expect(t.player.view.getState().playing).toBeNull();
  });

  it('a refused sound shows failed for six seconds and rethrows', async () => {
    const t = setup();
    await expect(
      t.player.play({
        kind: 'key',
        durSec: 2,
        segments: [],
        schedule: () => Promise.reject(new Error('no context')),
      }),
    ).rejects.toThrow('no context');
    expect(t.player.view.getState()).toMatchObject({ playing: null, failed: true });
    t.advance(SOUND_FAILED_MS / 1000 - 0.1);
    expect(t.player.view.getState().failed).toBe(true);
    t.advance(0.2);
    expect(t.player.view.getState().failed).toBe(false);
  });

  it('follow shows captions for a sound scheduled elsewhere without stopping anything', () => {
    const t = setup();
    t.player.follow({ kind: 'reference', durSec: 2.75, segments: [{ atSec: 0, caption: { kind: 'note', midi: 55 } }] }, t.now() + 0.1);
    expect(t.stops()).toBe(0);
    expect(t.player.view.getState().playing).toBe('reference');
    t.player.reset();
    expect(t.stops()).toBe(0);
    expect(t.player.view.getState().playing).toBeNull();
  });
});
