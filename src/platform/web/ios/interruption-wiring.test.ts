import { afterEach, describe, expect, it } from 'vitest';
import type { AudioRouteInfo, PlatformCapabilities } from '../../../core/platform.ts';
import type { SessionState } from '../../../core/types.ts';
import { WebAudioBackend } from '../audio/web-audio-backend.ts';
import { FakeAudioWorld, flush } from '../audio/testing/fake-web-audio.ts';
import { IDLE_CLOSE_MS } from './interruption.ts';
import { InterruptionController, type InterruptionAudio, type VoidAction } from './interruption-wiring.ts';

const caps: PlatformCapabilities = {
  platform: 'web', outputLatencyReported: true, wakeLock: true, serviceWorker: true, persistentStorage: 'best-effort', osFamily: 'ios', displayMode: 'browser',
};

/** Manual timers. */
class Timers {
  now = 0;
  private list: { at: number; fn: () => void; id: number }[] = [];
  private n = 0;
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.n;
    this.list.push({ at: this.now + ms, fn, id });
    return id;
  };
  clearTimeout = (h: unknown): void => {
    this.list = this.list.filter((t) => t.id !== h);
  };
  advance(ms: number): void {
    this.now += ms;
    for (const t of this.list.filter((x) => x.at <= this.now)) {
      this.list = this.list.filter((x) => x !== t);
      t.fn();
    }
  }
  get pending(): number {
    return this.list.length;
  }
}

interface Rec {
  voids: VoidAction[];
  stale: (string | null)[];
  closed: string[];
}

function rig(firstNote = false) {
  const world = new FakeAudioWorld({ audioSession: true });
  const be = new WebAudioBackend({ capabilities: caps, workletUrl: 'w.js', deps: world.deps });
  const timers = new Timers();
  const rec: Rec = { voids: [], stale: [], closed: [] };
  const state = { firstNote };
  const audio: InterruptionAudio = be;
  const ctl = new InterruptionController({
    audio,
    timers,
    firstNotePlayed: () => state.firstNote,
    sink: { onVoid: (a) => rec.voids.push(a), onStaleCalibration: (k) => rec.stale.push(k), onAudioClosed: (c) => rec.closed.push(c) },
  });
  ctl.start();
  return { world, be, timers, rec, ctl, state };
}

const open: (() => void)[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c();
});

async function unlocked(r: ReturnType<typeof rig>): Promise<AudioRouteInfo> {
  open.push(() => {
    for (const c of r.world.contexts) for (const n of c.workletNodes) n.closePorts();
  });
  const route = await r.be.unlock();
  await flush();
  return route;
}

const liveTracks = (w: FakeAudioWorld): number => w.tracks.filter((t) => t.readyState === 'live').length;

describe('IOS2 wiring on the fake backend (W4)', () => {
  const take: SessionState[] = ['count-in', 'performing'];
  const hide: [string, (w: FakeAudioWorld) => void][] = [
    ['visibilitychange hidden', (w) => { w.document.visibilityState = 'hidden'; w.document.dispatch('visibilitychange'); }],
    ['pagehide', (w) => w.window.dispatch('pagehide')],
    ['freeze', (w) => w.document.dispatch('freeze')],
  ];
  const others: [string, (w: FakeAudioWorld) => void][] = [
    ['context interrupted', (w) => w.ctx.setState('interrupted')],
    ['unrequested suspend', (w) => w.ctx.setState('suspended')],
    ['track mute', (w) => w.tracks[0]!.dispatch('mute')],
    ['track ended', (w) => w.tracks[0]!.end()],
  ];

  for (const st of take) {
    for (const [name, fire] of [...hide, ...others]) {
      it(`${st}: ${name} voids once with the burned-excerpt flag`, async () => {
        const r = rig();
        await unlocked(r);
        r.ctl.setSession(st);
        fire(r.world);
        await flush();
        expect(r.rec.voids).toHaveLength(1);
        expect(r.rec.voids[0]).toMatchObject({ reason: 'interrupted', burnExcerpt: true, requireGesture: true, countsAsSkip: false });
        expect(r.ctl.needsGesture).toBe(true);
      });
    }
    it(`${st}: hide stops every track and closes the context within the same tick`, async () => {
      const r = rig();
      await unlocked(r);
      r.ctl.setSession(st);
      hide[0]![1](r.world);
      await flush();
      expect(liveTracks(r.world)).toBe(0);
      expect(r.world.ctx.state).toBe('closed');
      expect(r.rec.closed).toEqual(['hidden']);
    });
    it(`${st}: hidden, pagehide and freeze together make one void`, async () => {
      const r = rig(true);
      await unlocked(r);
      r.ctl.setSession(st);
      for (const [, fire] of hide) fire(r.world);
      await flush();
      expect(r.rec.voids).toHaveLength(1);
      expect(r.rec.voids[0]!.countsAsSkip).toBe(true);
    });
    it(`${st}: a device change voids as device-change, whatever the new key`, async () => {
      const r = rig();
      await unlocked(r);
      r.ctl.setSession(st);
      let started = false;
      void r.be.startCapture(() => undefined).then(() => (started = true));
      for (let i = 0; i < 50 && !started; i++) await r.world.advance(6);
      expect(started).toBe(true);
      r.world.mediaDevices.dispatch('devicechange');
      await flush();
      expect(r.rec.voids).toHaveLength(1);
      expect(r.rec.voids[0]!.reason).toBe('device-change');
    });
  }

  it('outside a take: hide closes the audio, mute and interruption are ignored, a void is never raised', async () => {
    for (const st of ['idle', 'scanning', 'finishing', 'results'] as SessionState[]) {
      const r = rig();
      await unlocked(r);
      r.ctl.setSession(st);
      r.world.ctx.setState('interrupted');
      r.world.tracks[0]!.dispatch('mute');
      await flush();
      expect(r.rec.closed).toEqual([]);
      hide[1]![1](r.world);
      await flush();
      expect(r.rec.voids).toEqual([]);
      expect(r.rec.closed).toEqual(['hidden']);
      expect(liveTracks(r.world)).toBe(0);
    }
  });

  it('a new take after the void state changes can void again', async () => {
    const r = rig();
    await unlocked(r);
    r.ctl.setSession('performing');
    r.world.tracks[0]!.dispatch('mute');
    r.ctl.setSession('results');
    r.ctl.setSession('count-in');
    r.world.tracks[0]!.dispatch('mute');
    expect(r.rec.voids).toHaveLength(2);
  });

  it('restart without a gesture never calls resume() or getUserMedia; with a gesture it unlocks again', async () => {
    const r = rig();
    await unlocked(r);
    r.ctl.setSession('performing');
    hide[0]![1](r.world);
    await flush();
    const before = r.world.calls.length;
    const res = await r.ctl.unlockFromGesture(false);
    expect(res).toEqual({ ok: false, reason: 'needs-gesture' });
    expect(r.world.calls.length).toBe(before);
    expect(r.ctl.needsGesture).toBe(true);
    r.world.document.visibilityState = 'visible';
    r.ctl.setSession('idle');
    const p = r.ctl.unlockFromGesture(true);
    expect(r.world.calls.slice(before, before + 2)).toEqual(['audioSession.type=play-and-record', 'createContext']);
    expect(r.world.calls[before + 2]).toBe('resume');
    const ok = await p;
    expect(ok.ok).toBe(true);
    expect(r.ctl.needsGesture).toBe(false);
    expect(liveTracks(r.world)).toBe(1);
  });
});

describe('IOS2 wiring: W2 session lifetime', () => {
  it('ten takes in a row call getUserMedia once', async () => {
    const r = rig();
    await unlocked(r);
    for (let i = 0; i < 10; i++) {
      r.ctl.setSession('scanning');
      await r.ctl.unlockFromGesture(true);
      r.ctl.setSession('count-in');
      r.ctl.setSession('performing');
      r.ctl.setSession('results');
    }
    expect(r.world.gumCount).toBe(1);
    expect(r.rec.voids).toEqual([]);
  });

  it('5 minutes idle on results closes the stream; activity restarts the clock', async () => {
    const r = rig();
    await unlocked(r);
    r.ctl.setSession('results');
    r.timers.advance(IDLE_CLOSE_MS - 1000);
    r.ctl.touch();
    r.timers.advance(IDLE_CLOSE_MS - 1000);
    expect(liveTracks(r.world)).toBe(1);
    r.timers.advance(1000);
    await flush();
    expect(liveTracks(r.world)).toBe(0);
    expect(r.world.ctx.state).toBe('closed');
    expect(r.rec.closed).toEqual(['idle-timeout']);
  });

  it('leaving results cancels the idle timer', async () => {
    const r = rig();
    await unlocked(r);
    r.ctl.setSession('results');
    expect(r.timers.pending).toBe(1);
    r.ctl.setSession('loading');
    expect(r.timers.pending).toBe(0);
    r.timers.advance(IDLE_CLOSE_MS * 2);
    expect(liveTracks(r.world)).toBe(1);
  });

  it('leaving practice stops all tracks', async () => {
    const r = rig();
    await unlocked(r);
    r.ctl.setSession('results');
    r.ctl.leavePractice();
    await flush();
    expect(liveTracks(r.world)).toBe(0);
    expect(r.timers.pending).toBe(0);
    expect(r.rec.closed).toEqual(['left-practice']);
  });
});

describe('IOS2 wiring: W7 route changes', () => {
  it('between takes a changed route key marks the calibration stale; no void', async () => {
    const r = rig();
    const first = await unlocked(r);
    r.ctl.setSession('results');
    r.be.setOutputMode('wired');
    expect(r.rec.stale).toHaveLength(1);
    expect(r.rec.stale[0]).not.toBe(first.routeKey);
    expect(r.rec.voids).toEqual([]);
  });

  it('declaring the same output mode again changes nothing', async () => {
    const r = rig();
    await unlocked(r);
    r.ctl.setSession('results');
    r.be.setOutputMode('speakers');
    expect(r.rec.stale).toEqual([]);
  });

  it('mid-take a changed output mode voids as device-change', async () => {
    const r = rig();
    await unlocked(r);
    r.ctl.setSession('performing');
    r.be.setOutputMode('bluetooth');
    expect(r.rec.voids).toHaveLength(1);
    expect(r.rec.voids[0]!.reason).toBe('device-change');
    expect(r.rec.stale).toEqual([]);
  });

  it('dispose stops reacting', async () => {
    const r = rig();
    await unlocked(r);
    r.ctl.dispose();
    r.ctl.setSession('performing');
    r.world.tracks[0]!.dispatch('mute');
    expect(r.rec.voids).toEqual([]);
  });
});
