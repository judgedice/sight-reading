import { describe, expect, it } from 'vitest';
import type { KeyValue } from '../../../core/platform.ts';
import type { JsonValue } from '../../../core/types.ts';
import { IDLE_CLOSE_MS } from './interruption.ts';
import {
  createPersistTrigger,
  KeepAwakeController,
  wakeLockFromNavigator,
  type WakeLockLike,
  type WakeLockSentinelLike,
} from './keep-awake.ts';

/** Manual timers: `advance` fires every timer that is due. */
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
  get pending(): number {
    return this.list.length;
  }
  advance(ms: number): void {
    this.now += ms;
    for (const t of this.list.filter((x) => x.at <= this.now).sort((a, b) => a.at - b.at)) {
      this.list = this.list.filter((x) => x !== t);
      t.fn();
    }
  }
}

/** A fake `navigator.wakeLock`. Each request is recorded and resolved or rejected by the test. */
class FakeWakeLock implements WakeLockLike {
  requests = 0;
  sentinels: FakeSentinel[] = [];
  /** Next request outcome; defaults to granted. */
  nextOutcome: 'grant' | 'reject' = 'grant';
  /** When set, requests stay pending until `settle()`. */
  deferred: { resolve: (s: WakeLockSentinelLike) => void; reject: (e: unknown) => void } | null = null;
  request(type: 'screen'): Promise<WakeLockSentinelLike> {
    expect(type).toBe('screen');
    this.requests++;
    if (this.deferred === null && this.nextOutcome === 'reject') {
      return Promise.reject(new Error('NotAllowedError'));
    }
    if (this.deferred !== null) {
      return new Promise((resolve, reject) => {
        this.deferred = { resolve, reject };
      });
    }
    const s = new FakeSentinel();
    this.sentinels.push(s);
    return Promise.resolve(s);
  }
  get held(): FakeSentinel | undefined {
    return this.sentinels.filter((s) => !s.released).at(-1);
  }
}

class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  releases = 0;
  private listeners: (() => void)[] = [];
  async release(): Promise<void> {
    if (!this.released) {
      this.released = true;
      this.releases++;
    }
  }
  addEventListener(_type: 'release', listener: () => void): void {
    this.listeners.push(listener);
  }
  /** The browser drops the lock on its own (for example on hide). */
  dropBySystem(): void {
    this.released = true;
    for (const l of this.listeners) l();
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(opts: { wakeLock?: WakeLockLike | undefined; idleMs?: number } = {}) {
  const timers = new Timers();
  const lock = opts.wakeLock === undefined && 'wakeLock' in opts ? undefined : (opts.wakeLock ?? new FakeWakeLock());
  const ctrl = new KeepAwakeController({ wakeLock: lock, timers, idleMs: opts.idleMs });
  return { timers, ctrl, lock: lock as FakeWakeLock | undefined };
}

describe('IOS4 keep-awake: request timing', () => {
  it('requests the screen lock in the Start-scan gesture and holds it', async () => {
    const { ctrl, lock } = setup();
    expect(await ctrl.startPractice()).toBe(true);
    expect(lock!.requests).toBe(1);
    expect(ctrl.isHeld()).toBe(true);
  });

  it('is never requested outside practice', async () => {
    const { ctrl, lock, timers } = setup();
    ctrl.onVisibility(true);
    ctrl.touch();
    ctrl.enterResults();
    timers.advance(IDLE_CLOSE_MS * 2);
    await flush();
    expect(lock!.requests).toBe(0);
    expect(ctrl.isHeld()).toBe(false);
  });

  it('does not request twice while a lock is held or a request is in flight', async () => {
    const { ctrl, lock } = setup();
    await ctrl.startPractice();
    await ctrl.startPractice();
    ctrl.onVisibility(true);
    expect(lock!.requests).toBe(1);
  });

  it('keepAwake(true) and keepAwake(false) are the PlatformServices adapter', async () => {
    const { ctrl, lock } = setup();
    await ctrl.keepAwake(true);
    expect(lock!.requests).toBe(1);
    await ctrl.keepAwake(false);
    await flush();
    expect(lock!.held).toBeUndefined();
  });

  it('re-requests on return to visible while in practice, after the browser dropped the lock', async () => {
    const { ctrl, lock } = setup();
    await ctrl.startPractice();
    lock!.held!.dropBySystem();
    ctrl.onVisibility(false);
    expect(ctrl.isHeld()).toBe(false);
    ctrl.onVisibility(true);
    await flush();
    expect(lock!.requests).toBe(2);
    expect(ctrl.isHeld()).toBe(true);
  });

  it('a system release event clears the held flag without a visibility change', async () => {
    const { ctrl, lock } = setup();
    await ctrl.startPractice();
    lock!.held!.dropBySystem();
    expect(ctrl.isHeld()).toBe(false);
  });

  it('releases on leaving practice', async () => {
    const { ctrl, lock } = setup();
    await ctrl.startPractice();
    const s = lock!.held!;
    ctrl.leavePractice();
    await flush();
    expect(s.released).toBe(true);
    expect(s.releases).toBe(1);
    expect(ctrl.isHeld()).toBe(false);
  });

  it('a request still in flight when practice ends is released as soon as it is granted', async () => {
    const timers = new Timers();
    const lock = new FakeWakeLock();
    lock.deferred = { resolve: () => undefined, reject: () => undefined };
    const ctrl = new KeepAwakeController({ wakeLock: lock, timers });
    const pending = ctrl.startPractice();
    ctrl.leavePractice();
    lock.deferred!.resolve(new FakeSentinel());
    expect(await pending).toBe(false);
    await flush();
    expect(lock.sentinels[0]!.released).toBe(true);
    expect(ctrl.isHeld()).toBe(false);
  });

  it('dispose releases the lock and later calls do nothing', async () => {
    const { ctrl, lock } = setup();
    await ctrl.startPractice();
    ctrl.dispose();
    await flush();
    expect(lock!.held).toBeUndefined();
    expect(await ctrl.startPractice()).toBe(false);
    expect(lock!.requests).toBe(1);
  });
});

describe('IOS4 keep-awake: results idle release', () => {
  it('releases after five minutes idle on results', async () => {
    const { ctrl, lock, timers } = setup();
    await ctrl.startPractice();
    ctrl.enterResults();
    timers.advance(IDLE_CLOSE_MS - 1);
    expect(ctrl.isHeld()).toBe(true);
    timers.advance(1);
    await flush();
    expect(ctrl.isHeld()).toBe(false);
    expect(lock!.sentinels[0]!.released).toBe(true);
  });

  it('a touch on results restarts the countdown', async () => {
    const { ctrl, timers } = setup();
    await ctrl.startPractice();
    ctrl.enterResults();
    timers.advance(IDLE_CLOSE_MS - 1000);
    ctrl.touch();
    timers.advance(IDLE_CLOSE_MS - 1000);
    expect(ctrl.isHeld()).toBe(true);
    timers.advance(1000);
    await flush();
    expect(ctrl.isHeld()).toBe(false);
  });

  it('after the idle release, a touch requests the lock again; visibility alone does not', async () => {
    const { ctrl, lock, timers } = setup();
    await ctrl.startPractice();
    ctrl.enterResults();
    timers.advance(IDLE_CLOSE_MS);
    await flush();
    ctrl.onVisibility(false);
    ctrl.onVisibility(true);
    await flush();
    expect(lock!.requests).toBe(1);
    ctrl.touch();
    await flush();
    expect(lock!.requests).toBe(2);
    expect(ctrl.isHeld()).toBe(true);
  });

  it('leaving results cancels the idle timer', async () => {
    const { ctrl, timers } = setup();
    await ctrl.startPractice();
    ctrl.enterResults();
    ctrl.leaveResults();
    expect(timers.pending).toBe(0);
    timers.advance(IDLE_CLOSE_MS * 2);
    expect(ctrl.isHeld()).toBe(true);
  });

  it('a custom idle time is honoured', async () => {
    const { ctrl, timers } = setup({ idleMs: 1000 });
    await ctrl.startPractice();
    ctrl.enterResults();
    timers.advance(1000);
    await flush();
    expect(ctrl.isHeld()).toBe(false);
  });
});

describe('IOS4 keep-awake: rejection and missing API', () => {
  it('a rejected request raises the hint flag and is otherwise silent', async () => {
    const lock = new FakeWakeLock();
    lock.nextOutcome = 'reject';
    const { ctrl } = setup({ wakeLock: lock });
    expect(ctrl.autoLockHintRaised()).toBe(false);
    await expect(ctrl.startPractice()).resolves.toBe(false);
    expect(ctrl.autoLockHintRaised()).toBe(true);
    expect(ctrl.isHeld()).toBe(false);
  });

  it('the flag is set once per session however many requests are rejected', async () => {
    const lock = new FakeWakeLock();
    lock.nextOutcome = 'reject';
    const { ctrl } = setup({ wakeLock: lock });
    await ctrl.startPractice();
    ctrl.onVisibility(true);
    await flush();
    await ctrl.startPractice();
    expect(lock.requests).toBeGreaterThanOrEqual(2);
    expect(ctrl.autoLockHintRaised()).toBe(true);
  });

  it('a missing wakeLock API raises the hint without throwing', async () => {
    const { ctrl } = setup({ wakeLock: undefined });
    await expect(ctrl.startPractice()).resolves.toBe(false);
    expect(ctrl.autoLockHintRaised()).toBe(true);
  });

  it('a later grant after an earlier rejection holds the lock and keeps the flag', async () => {
    const lock = new FakeWakeLock();
    lock.nextOutcome = 'reject';
    const { ctrl } = setup({ wakeLock: lock });
    await ctrl.startPractice();
    lock.nextOutcome = 'grant';
    ctrl.onVisibility(true);
    await flush();
    expect(ctrl.isHeld()).toBe(true);
    expect(ctrl.autoLockHintRaised()).toBe(true);
  });
});

describe('IOS4 persist trigger', () => {
  class MemKv implements KeyValue {
    private m = new Map<string, JsonValue>();
    async get(k: string) {
      return this.m.get(k);
    }
    async set(k: string, v: JsonValue) {
      this.m.set(k, v);
    }
    async delete(k: string) {
      this.m.delete(k);
    }
    async keys() {
      return [...this.m.keys()];
    }
  }

  it('calls persist() exactly once across attempts in a session', async () => {
    const kv = new MemKv();
    let calls = 0;
    const storage = { persist: async () => (calls++, true) };
    const trigger = createPersistTrigger(kv, storage);
    expect(await trigger.attemptCompleted()).toBe(true);
    expect(await trigger.attemptCompleted()).toBeNull();
    expect(await trigger.attemptCompleted()).toBeNull();
    expect(calls).toBe(1);
  });

  it('does not call persist() again in a later session once the install has asked', async () => {
    const kv = new MemKv();
    let calls = 0;
    const storage = { persist: async () => (calls++, false) };
    await createPersistTrigger(kv, storage).attemptCompleted();
    await createPersistTrigger(kv, storage).attemptCompleted();
    expect(calls).toBe(1);
  });

  it('a missing storage API resolves null and does not throw', async () => {
    const trigger = createPersistTrigger(new MemKv(), undefined);
    expect(await trigger.attemptCompleted()).toBeNull();
  });
});

describe('IOS4 wakeLockFromNavigator', () => {
  it('returns the wake lock only when request is a function', () => {
    const wl = { request: async () => new FakeSentinel() };
    expect(wakeLockFromNavigator({ wakeLock: wl })).toBe(wl);
    expect(wakeLockFromNavigator({})).toBeUndefined();
    expect(wakeLockFromNavigator({ wakeLock: undefined })).toBeUndefined();
    expect(wakeLockFromNavigator(undefined)).toBeUndefined();
  });
});
