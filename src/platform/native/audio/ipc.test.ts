import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodePutBuffer, encodeDecodeReply } from './wire.ts';

const invoke = vi.fn();
class FakeChannel<T> {
  static all: FakeChannel<unknown>[] = [];
  onmessage: (m: T) => void;
  constructor(cb: (m: T) => void) {
    this.onmessage = cb;
    FakeChannel.all.push(this as FakeChannel<unknown>);
  }
}
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a), Channel: FakeChannel }));

const { TauriNativeIpc } = await import('./ipc.ts');

beforeEach(() => {
  invoke.mockReset();
  FakeChannel.all = [];
});

describe('TauriNativeIpc', () => {
  it('sends flat camelCase arguments under the command names of the engine', async () => {
    const ipc = new TauriNativeIpc();
    invoke.mockResolvedValue(undefined);
    await ipc.cancel({ group: 'take', fadeSec: 0.005 });
    await ipc.stopVoices({ ids: [1, 2], fadeSec: 0.015 });
    await ipc.dropBuffers({ ids: [3] });
    await ipc.permission({ request: true });
    await ipc.clockCheck({ durSec: 2 });
    await ipc.schedule({ group: 'sounds', voices: [{ id: 1, buffer: 2, t: 3, gain: 1 }] });
    await ipc.close();
    await ipc.releaseInput();
    await ipc.clockSync();
    await ipc.captureStop();
    await ipc.measureLoopback({ clicks: 8, timbre: 'tick' });
    expect(invoke.mock.calls).toEqual([
      ['audio_cancel', { group: 'take', fadeSec: 0.005 }],
      ['audio_stop_voices', { ids: [1, 2], fadeSec: 0.015 }],
      ['audio_drop_buffers', { ids: [3] }],
      ['audio_permission', { request: true }],
      ['audio_clock_check', { durSec: 2 }],
      ['audio_schedule', { group: 'sounds', voices: [{ id: 1, buffer: 2, t: 3, gain: 1 }] }],
      ['audio_close', undefined],
      ['audio_release_input', undefined],
      ['audio_clock_sync', undefined],
      ['audio_capture_stop', undefined],
      ['audio_measure_loopback', { clicks: 8, timbre: 'tick' }],
    ]);
  });

  it('open passes the events as a channel and routes its messages to the callback', async () => {
    const ipc = new TauriNativeIpc();
    invoke.mockResolvedValue({ engineRate: 48000 });
    const got: unknown[] = [];
    await ipc.open({ input: true, outputMode: 'wired', onEvent: (e) => got.push(e) });
    const [cmd, args] = invoke.mock.calls[0] as [string, { input: boolean; outputMode: string; events: FakeChannel<unknown> }];
    expect(cmd).toBe('audio_open');
    expect(args).toMatchObject({ input: true, outputMode: 'wired' });
    args.events.onmessage({ type: 'ended', ids: [1] });
    expect(got).toEqual([{ type: 'ended', ids: [1] }]);
  });

  it('captureStart passes a channel for packets and the packet size', async () => {
    const ipc = new TauriNativeIpc();
    invoke.mockResolvedValue({ originFrame: 5, engineRate: 48000, path: 'locked' });
    const got: ArrayBuffer[] = [];
    await ipc.captureStart({ packetFrames: 512, onPacket: (b) => got.push(b) });
    const args = invoke.mock.calls[0]?.[1] as { packetFrames: number; packets: FakeChannel<ArrayBuffer> };
    expect(invoke.mock.calls[0]?.[0]).toBe('audio_capture_start');
    expect(args.packetFrames).toBe(512);
    const b = new ArrayBuffer(8);
    args.packets.onmessage(b);
    expect(got).toEqual([b]);
  });

  it('putBuffer sends the raw SRB1 payload as bytes', async () => {
    const ipc = new TauriNativeIpc();
    invoke.mockResolvedValue(undefined);
    await ipc.putBuffer({ id: 7, sampleRate: 48000, samples: new Float32Array([1, 2]) });
    const [cmd, payload] = invoke.mock.calls[0] as [string, Uint8Array];
    expect(cmd).toBe('audio_put_buffer');
    expect(payload).toBeInstanceOf(Uint8Array);
    expect(payload).toEqual(encodePutBuffer(7, 48000, new Float32Array([1, 2])));
  });

  it('decode sends id and file bytes raw and parses the raw reply', async () => {
    const ipc = new TauriNativeIpc();
    invoke.mockResolvedValue(encodeDecodeReply(44100, new Float32Array([0.5, -0.5])));
    const r = await ipc.decode({ id: 9, file: new Uint8Array([1, 2, 3]).buffer });
    const [cmd, payload] = invoke.mock.calls[0] as [string, Uint8Array];
    expect(cmd).toBe('audio_decode');
    expect(Array.from(payload)).toEqual([9, 0, 0, 0, 1, 2, 3]);
    expect(r.sampleRate).toBe(44100);
    expect(Array.from(r.samples)).toEqual([0.5, -0.5]);
  });

  it('turns an engine string error into an Error', async () => {
    const ipc = new TauriNativeIpc();
    invoke.mockRejectedValue('audio is not open: call audio_open first');
    await expect(ipc.cancel({ group: 'take', fadeSec: 0 })).rejects.toThrow('audio is not open');
  });
});
