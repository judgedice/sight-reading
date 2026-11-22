// SoundPlayer (05 §8.8, §9.3): one sound at a time, captions on the backend clock, back to idle at the end, and a
// failure shown for six seconds.
import { describe, expect, it } from 'vitest';
import { SOUND_FAILED_MS, SOUND_LEAD_SEC, SoundPlayer } from './sounds.ts';

function setup(o: { lagSec?: number } = {}) {
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
  const audible = o.lagSec === undefined ? {} : { audibleNow: () => (now - (o.lagSec as number)) as never };
  const player = new SoundPlayer({ now: () => now as never, stopSounds: () => void stops++, ...audible }, timers);
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

describe('round 2 sounds', () => {
  it('a range run names its instrument and its notes; idle clears the instrument', async () => {
    const t = setup();
    await t.player.play({
      kind: 'range',
      durSec: 1.75,
      instrumentId: 'voice-tenor',
      segments: [
        { atSec: 0, caption: { kind: 'range-note', index: 0, midi: 48 } },
        { atSec: 0.95, caption: { kind: 'range-note', index: 1, midi: 60 } },
      ],
      schedule: () => Promise.resolve(),
    });
    expect(t.player.view.getState()).toMatchObject({ playing: 'range', instrumentId: 'voice-tenor', caption: { kind: 'range-note', index: 0, midi: 48 } });
    t.advance(SOUND_LEAD_SEC + 1);
    expect(t.player.view.getState().caption).toEqual({ kind: 'range-note', index: 1, midi: 60 });
    t.advance(1);
    expect(t.player.view.getState()).toMatchObject({ playing: null, instrumentId: null, caption: null });
  });
});

describe('Listen playback review: captions as heard and the notes for the sounding-note highlight', () => {
  it('a caption changes when its clock time comes out of the speakers (the output latency later), not when it is scheduled', async () => {
    const t = setup({ lagSec: 0.2 });
    await t.player.play({
      kind: 'reference',
      durSec: 2,
      segments: [
        { atSec: 0, caption: { kind: 'note', midi: 48 } },
        { atSec: 1, caption: { kind: 'note', midi: 55 } },
      ],
      schedule: () => Promise.resolve(),
    });
    // Origin at now + 80 ms; the second segment is scheduled at +1.08 s and heard at +1.28 s.
    t.advance(1.27);
    expect(t.player.view.getState().caption).toEqual({ kind: 'note', midi: 48 });
    t.advance(0.02);
    expect(t.player.view.getState().caption).toEqual({ kind: 'note', midi: 55 });
    t.advance(0.9);
    expect(t.player.view.getState().playing).toBe('reference');
    t.advance(0.2);
    expect(t.player.view.getState().playing).toBeNull();
  });

  it('a heard clock ahead of the scheduling clock, or far behind it, is not trusted', () => {
    const ahead = new SoundPlayer({ now: () => 5 as never, stopSounds: () => undefined, audibleNow: () => 5.5 as never }, { setTimeout: () => 0, clearTimeout: () => undefined });
    expect(ahead.heardNow()).toBe(5);
    const stale = new SoundPlayer({ now: () => 5 as never, stopSounds: () => undefined, audibleNow: () => 2 as never }, { setTimeout: () => 0, clearTimeout: () => undefined });
    expect(stale.heardNow()).toBe(5);
    const ok = new SoundPlayer({ now: () => 5 as never, stopSounds: () => undefined, audibleNow: () => 4.95 as never }, { setTimeout: () => 0, clearTimeout: () => undefined });
    expect(ok.heardNow()).toBe(4.95);
  });

  it('the notes are set once, in clock time and start order, with the heard clock; idle and Stop clear them', async () => {
    const t = setup({ lagSec: 0.05 });
    let origin = 0;
    await t.player.play({
      kind: 'listen',
      durSec: 3,
      segments: [{ atSec: 0, caption: { kind: 'lead-in', bpm: 120 } }],
      notes: [
        { idx: 1, eventIds: ['e2'], atSec: 2, untilSec: 2.5 },
        { idx: 0, eventIds: ['e1', 'e1b'], atSec: 1, untilSec: 2 },
      ],
      schedule: async (o) => {
        origin = o;
      },
    });
    const notes = t.player.view.getState().notes;
    expect(notes?.spans).toEqual([
      { idx: 0, eventIds: ['e1', 'e1b'], startsAt: origin + 1, endsAt: origin + 2 },
      { idx: 1, eventIds: ['e2'], startsAt: origin + 2, endsAt: origin + 2.5 },
    ]);
    expect(notes?.clock()).toBeCloseTo(t.now() - 0.05, 9);
    t.player.stop();
    expect(t.player.view.getState().notes).toBeNull();
    await t.player.play({ kind: 'tempo', durSec: 1, segments: [{ atSec: 0, caption: { kind: 'tempo', bpm: 60 } }], schedule: () => Promise.resolve() });
    expect(t.player.view.getState().notes).toBeNull();
  });

  it('the beat line timing (PLAN R70) moves the sounding note and the captions, never the sound', async () => {
    const t = setup({ lagSec: 0.05 });
    t.player.visualOffsetSec = 0.1; // 100 ms later
    let origin = 0;
    const shown: (string | null)[] = [];
    t.player.view.subscribe((v) => shown.push(v.caption?.kind ?? null));
    await t.player.play({
      kind: 'listen',
      durSec: 3,
      segments: [
        { atSec: 0, caption: { kind: 'lead-in', bpm: 120 } },
        { atSec: 1, caption: { kind: 'bar', bar: 1, of: 2 }, bar: 1 },
      ],
      notes: [{ idx: 0, eventIds: ['e1'], atSec: 1, untilSec: 2 }],
      schedule: async (o) => {
        origin = o;
      },
    });
    // The scheduled sound is untouched.
    expect(origin).toBeCloseTo(10 + SOUND_LEAD_SEC, 9);
    // The note clock is the heard clock less the offset.
    expect(t.player.view.getState().notes?.clock()).toBeCloseTo(t.now() - 0.05 - 0.1, 9);
    // The bar caption comes 100 ms after it is heard, not when it is heard.
    const heardAt = origin + 1 + 0.05 - t.now();
    t.player.view.setState({}, false);
    t.advance(heardAt + 0.09);
    expect(t.player.view.getState().caption?.kind).toBe('lead-in');
    t.advance(0.02);
    expect(t.player.view.getState().caption?.kind).toBe('bar');
    expect(shown).toContain('bar');
  });
});
