import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CaptureBlock } from '../../../core/platform.ts';
import { NativeCaptureFeed, type CaptureFault } from './capture-feed.ts';
import {
  decodeDecodeRequest,
  decodePutBuffer,
  encodeCapturePacket,
  encodeDecodeReply,
  encodeDecodeRequest,
  encodePutBuffer,
  PACKET_FLAGS,
  PACKET_HEADER_BYTES,
  parseCapturePacket,
  parseDecodeReply,
  WireError,
} from './wire.ts';

/** xorshift32 over the full bit range, so NaN payloads and negative zero appear. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

const bitsOf = (x: Float32Array): number[] => Array.from(new Uint32Array(x.buffer, x.byteOffset, x.length));

describe('capture packet layout (design section 3)', () => {
  it('has the 24-byte header at the documented offsets, little-endian', () => {
    const buf = encodeCapturePacket({ flags: PACKET_FLAGS.resampled | PACKET_FLAGS.last, seq: 0x01020304, firstFrame: 2 ** 40 + 5, droppedBefore: 0x0a0b0c0d }, new Float32Array([1, -2]));
    expect(buf.byteLength).toBe(PACKET_HEADER_BYTES + 8);
    const b = new Uint8Array(buf);
    expect(Array.from(b.subarray(0, 4))).toEqual([1, 1, 0b1001, 0]);
    expect(Array.from(b.subarray(4, 8))).toEqual([4, 3, 2, 1]);
    expect(new DataView(buf).getFloat64(8, true)).toBe(2 ** 40 + 5);
    expect(Array.from(b.subarray(16, 20))).toEqual([2, 0, 0, 0]);
    expect(Array.from(b.subarray(20, 24))).toEqual([0x0d, 0x0c, 0x0b, 0x0a]);
    expect(Array.from(b.subarray(24, 28))).toEqual([0, 0, 0x80, 0x3f]);
  });

  it('parses what it encodes, for any bit pattern (NaN payloads, negative zero), packet sizes 0 to 2048', () => {
    const next = rng(0x5eed0001);
    for (let i = 0; i < 300; i++) {
      const n = i % 5 === 0 ? 0 : i % 5 === 1 ? 512 : next() % 2049;
      const samples = new Float32Array(n);
      new Uint32Array(samples.buffer).forEach((_, k, u) => (u[k] = next()));
      const h = { flags: next() & 0xf, seq: next(), firstFrame: Number(BigInt(next()) * 2048n + BigInt(next() % 2048)), droppedBefore: next() };
      const p = parseCapturePacket(encodeCapturePacket(h, samples));
      expect(p).toMatchObject({ flags: h.flags, seq: h.seq, firstFrame: h.firstFrame, droppedBefore: h.droppedBefore, nFrames: n });
      expect(bitsOf(p.samples)).toEqual(bitsOf(samples));
    }
  });

  it('views the samples in place, so the packet buffer is not copied', () => {
    const buf = encodeCapturePacket({ seq: 0, firstFrame: 0 }, new Float32Array(16));
    const p = parseCapturePacket(buf);
    expect(p.samples.buffer).toBe(buf);
    expect(p.samples.byteOffset).toBe(24);
  });

  it('refuses what is not a packet', () => {
    const good = encodeCapturePacket({ seq: 1, firstFrame: 10 }, new Float32Array(4));
    const reason = (b: ArrayBuffer): string => {
      try {
        parseCapturePacket(b);
      } catch (e) {
        return e instanceof WireError ? e.reason : 'other';
      }
      return 'parsed';
    };
    expect(reason(good.slice(0, 20))).toBe('too-short');
    expect(reason(good.slice(0, good.byteLength - 1))).toBe('length-mismatch');
    const kind = good.slice(0);
    new Uint8Array(kind)[0] = 2;
    expect(reason(kind)).toBe('bad-kind');
    const ver = good.slice(0);
    new Uint8Array(ver)[1] = 9;
    expect(reason(ver)).toBe('bad-version');
    const frac = good.slice(0);
    new DataView(frac).setFloat64(8, 10.5, true);
    expect(reason(frac)).toBe('bad-value');
    const neg = good.slice(0);
    new DataView(neg).setFloat64(8, -1, true);
    expect(reason(neg)).toBe('bad-value');
    const nan = good.slice(0);
    new DataView(nan).setFloat64(8, NaN, true);
    expect(reason(nan)).toBe('bad-value');
    expect(reason(good)).toBe('parsed');
  });
});

describe('audio_put_buffer and audio_decode payloads', () => {
  it('put_buffer starts with the bytes S R B 1, then u32 id, rate, frames, then the samples', () => {
    const samples = new Float32Array([0.5, -0.25, 1]);
    const b = encodePutBuffer(0xdeadbeef, 44100, samples);
    expect(Array.from(b.subarray(0, 4))).toEqual([0x53, 0x52, 0x42, 0x31]);
    expect(String.fromCharCode(...b.subarray(0, 4))).toBe('SRB1');
    expect(Array.from(b.subarray(4, 8))).toEqual([0xef, 0xbe, 0xad, 0xde]);
    expect(Array.from(b.subarray(8, 12))).toEqual([0x44, 0xac, 0, 0]);
    expect(Array.from(b.subarray(12, 16))).toEqual([3, 0, 0, 0]);
    expect(b.length).toBe(16 + 12);
    const back = decodePutBuffer(b);
    expect(back).toMatchObject({ bufferId: 0xdeadbeef, sampleRate: 44100 });
    expect(bitsOf(back.samples)).toEqual(bitsOf(samples));
  });

  it('put_buffer of an empty buffer and of a subarray view', () => {
    expect(decodePutBuffer(encodePutBuffer(1, 48000, new Float32Array(0))).samples).toHaveLength(0);
    const whole = new Float32Array([9, 8, 7, 6]);
    expect(Array.from(decodePutBuffer(encodePutBuffer(2, 48000, whole.subarray(1, 3))).samples)).toEqual([8, 7]);
  });

  it('put_buffer refuses a bad magic and a length that does not match', () => {
    const b = encodePutBuffer(1, 48000, new Float32Array(4));
    const bad = b.slice();
    bad[0] = 0x58;
    expect(() => decodePutBuffer(bad)).toThrow(WireError);
    expect(() => decodePutBuffer(b.subarray(0, b.length - 4))).toThrow(WireError);
    expect(() => decodePutBuffer(b.subarray(0, 8))).toThrow(WireError);
  });

  it('decode request is u32 id then the file bytes, the reply u32 rate, u32 frames, samples', () => {
    const file = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0xff, 0xfb]);
    const req = encodeDecodeRequest(77, file.buffer);
    expect(Array.from(req.subarray(0, 4))).toEqual([77, 0, 0, 0]);
    const parsed = decodeDecodeRequest(req);
    expect(parsed.bufferId).toBe(77);
    expect(Array.from(parsed.file)).toEqual(Array.from(file));
    const pcm = new Float32Array([0.1, -0.2, 0.3]);
    const reply = encodeDecodeReply(44100, pcm);
    expect(reply.byteLength).toBe(8 + 12);
    const r = parseDecodeReply(reply);
    expect(r.sampleRate).toBe(44100);
    expect(bitsOf(r.samples)).toEqual(bitsOf(pcm));
    expect(() => parseDecodeReply(reply.slice(0, 10))).toThrow(WireError);
    expect(() => parseDecodeReply(reply.slice(0, 4))).toThrow(WireError);
  });
});

/** A packet stream is its packets back to back: the header's frame count says where each ends. */
function splitPackets(file: Uint8Array): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  let at = 0;
  while (at < file.length) {
    if (file.length - at < PACKET_HEADER_BYTES) throw new Error(`fixture: ${file.length - at} stray bytes at ${at}`);
    const n = new DataView(file.buffer, file.byteOffset + at, PACKET_HEADER_BYTES).getUint32(16, true);
    const end = at + PACKET_HEADER_BYTES + n * 4;
    if (end > file.length) throw new Error(`fixture: packet at ${at} runs past the end of the file`);
    out.push(file.slice(at, end).buffer);
    at = end;
  }
  return out;
}

const FIXTURE = fileURLToPath(new URL('../../../../fixtures/native/capture-48k.bin', import.meta.url));

describe('wire golden (design section 8, test 2)', () => {
  it('a packet stream written by the encoder parses back to the samples that went in, bit for bit, in order', () => {
    const next = rng(42);
    const input = new Float32Array(48000);
    new Uint32Array(input.buffer).forEach((_, k, u) => (u[k] = (next() & 0x007fffff) | 0x3e000000));
    const sizes = [512, 480, 256, 1000, 37];
    const parts: Uint8Array[] = [];
    let pos = 0;
    let seq = 0;
    while (pos < input.length) {
      const n = Math.min(sizes[seq % sizes.length] as number, input.length - pos);
      parts.push(new Uint8Array(encodeCapturePacket({ seq, firstFrame: 1000 + pos }, input.subarray(pos, pos + n))));
      pos += n;
      seq++;
    }
    const file = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    parts.reduce((at, p) => (file.set(p, at), at + p.length), 0);
    const packets = splitPackets(file).map(parseCapturePacket);
    expect(packets.map((p) => p.seq)).toEqual(packets.map((_, i) => i));
    const out = new Float32Array(packets.reduce((a, p) => a + p.nFrames, 0));
    packets.reduce((at, p) => (out.set(p.samples, at), at + p.nFrames), 0);
    expect(bitsOf(out)).toEqual(bitsOf(input));
    for (let i = 1; i < packets.length; i++) expect((packets[i] as { firstFrame: number }).firstFrame).toBe((packets[i - 1] as { firstFrame: number }).firstFrame + (packets[i - 1] as { nFrames: number }).nFrames);
  });

  if (existsSync(FIXTURE)) {
    it('fixtures/native/capture-48k.bin (written by the engine): contiguous packets that re-encode to the same bytes and run through the feed without a gap', () => {
      const file = new Uint8Array(readFileSync(FIXTURE));
      const raw = splitPackets(file);
      expect(raw.length).toBeGreaterThan(0);
      const packets = raw.map(parseCapturePacket);
      expect(packets.map((p) => p.seq)).toEqual(packets.map((_, i) => packets[0]!.seq + i));
      for (let i = 1; i < packets.length; i++) {
        const prev = packets[i - 1]!;
        expect(packets[i]!.firstFrame, `firstFrame of packet ${i}`).toBe(prev.firstFrame + prev.nFrames);
        expect(packets[i]!.droppedBefore).toBe(0);
      }
      // The encoder here and the engine's agree on every byte (flags and all).
      packets.forEach((p, i) => {
        const again = encodeCapturePacket({ flags: p.flags, seq: p.seq, firstFrame: p.firstFrame, droppedBefore: p.droppedBefore }, p.samples);
        expect(new Uint8Array(again), `packet ${i}`).toEqual(new Uint8Array(raw[i] as ArrayBuffer));
      });
      const faults: CaptureFault[] = [];
      const blocks: CaptureBlock[] = [];
      const feed = new NativeCaptureFeed({ engineRate: 48000, sink: (m) => void (m.type === 'block' && blocks.push(m.block)), now: () => 0, backlogVoidMs: 120, onFault: (f) => faults.push(f) });
      for (const r of raw) feed.push(r.slice(0));
      expect(faults).toEqual([]);
      const frames = packets.reduce((a, p) => a + p.nFrames, 0);
      expect(blocks).toHaveLength(Math.floor(frames / 256));
    });
  } else {
    console.warn('wire-golden: fixtures/native/capture-48k.bin is not present (the engine example capture_golden writes it); the fixture case is not defined in this run.');
  }
});
