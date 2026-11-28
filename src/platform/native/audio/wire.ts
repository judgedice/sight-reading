/**
 * Binary layouts shared with the Rust engine (docs/native/AUDIO-DESIGN.md section 3). Pure: no Tauri, no DOM. All
 * fields are little-endian.
 *
 * - Capture packet (engine to webview): 24-byte header, then `nFrames` mono f32 samples. The header length is a
 *   multiple of 4, so the samples are viewed in place (`new Float32Array(buf, 24, n)`), no copy.
 * - `audio_put_buffer` payload (webview to engine): the bytes `S R B 1`, u32 bufferId, u32 sampleRate, u32 nFrames,
 *   then f32 samples.
 * - `audio_decode` request: u32 bufferId, then the MP3 file bytes. Reply: u32 sampleRate, u32 nFrames, f32 samples.
 */

export const PACKET_HEADER_BYTES = 24;
export const PACKET_KIND_CAPTURE = 1;
export const PACKET_VERSION = 1;
export const PUT_BUFFER_HEADER_BYTES = 16;
/** The first four bytes of an `audio_put_buffer` payload, in order. */
export const PUT_BUFFER_MAGIC: readonly number[] = [0x53, 0x52, 0x42, 0x31];

/** Packet header flag bits. */
export const PACKET_FLAGS = {
  /** The samples came through the resampled path. */
  resampled: 1 << 0,
  /** The capture has been 0.4 ms or more from where the engine's clocks put it for half a second; stays set. */
  drift: 1 << 1,
  /** Every input sample of the packet is exactly zero. */
  inputZero: 1 << 2,
  /** Last packet of the capture. */
  last: 1 << 3,
  /** A stream clock stepped (an xrun, an output restart): the engine ended the capture with this packet. */
  clockStep: 1 << 4,
} as const;

/** Flags that mean the capture's frame stamps cannot be trusted: the capture is void. */
export const PACKET_VOID_FLAGS = PACKET_FLAGS.drift | PACKET_FLAGS.clockStep;

/** Why a byte string is not a valid message. */
export class WireError extends Error {
  readonly reason: 'too-short' | 'bad-kind' | 'bad-version' | 'length-mismatch' | 'bad-value' | 'endianness';
  constructor(reason: WireError['reason'], message: string) {
    super(message);
    this.name = 'WireError';
    this.reason = reason;
  }
}

/** The typed-array views below assume the host stores f32 little-endian (every target platform does). */
const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export interface CapturePacket {
  flags: number;
  /** Packet number, from 0 per capture. */
  seq: number;
  /** Engine frame of sample 0 (an integer value). */
  firstFrame: number;
  nFrames: number;
  /** Engine frames lost before this packet. */
  droppedBefore: number;
  /** Mono samples, a view into the packet's buffer. */
  samples: Float32Array;
}

/** Reads one packet that fills `buf` exactly. The samples are a view into `buf`. */
export function parseCapturePacket(buf: ArrayBuffer): CapturePacket {
  if (!HOST_LITTLE_ENDIAN) throw new WireError('endianness', 'packet parsing needs a little-endian host');
  if (buf.byteLength < PACKET_HEADER_BYTES) throw new WireError('too-short', `packet of ${buf.byteLength} bytes is shorter than its header`);
  const v = new DataView(buf);
  if (v.getUint8(0) !== PACKET_KIND_CAPTURE) throw new WireError('bad-kind', `packet kind ${v.getUint8(0)}`);
  if (v.getUint8(1) !== PACKET_VERSION) throw new WireError('bad-version', `packet version ${v.getUint8(1)}`);
  const firstFrame = v.getFloat64(8, true);
  if (!(firstFrame >= 0) || !Number.isInteger(firstFrame)) throw new WireError('bad-value', `firstFrame ${firstFrame}`);
  const nFrames = v.getUint32(16, true);
  if (buf.byteLength !== PACKET_HEADER_BYTES + nFrames * 4) throw new WireError('length-mismatch', `${buf.byteLength} bytes for ${nFrames} frames`);
  return {
    flags: v.getUint16(2, true),
    seq: v.getUint32(4, true),
    firstFrame,
    nFrames,
    droppedBefore: v.getUint32(20, true),
    samples: new Float32Array(buf, PACKET_HEADER_BYTES, nFrames),
  };
}

/** Writes one packet (the engine does this in production; tests and the fake engine use it). */
export function encodeCapturePacket(h: { flags?: number; seq: number; firstFrame: number; droppedBefore?: number }, samples: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(PACKET_HEADER_BYTES + samples.length * 4);
  const v = new DataView(buf);
  v.setUint8(0, PACKET_KIND_CAPTURE);
  v.setUint8(1, PACKET_VERSION);
  v.setUint16(2, h.flags ?? 0, true);
  v.setUint32(4, h.seq, true);
  v.setFloat64(8, h.firstFrame, true);
  v.setUint32(16, samples.length, true);
  v.setUint32(20, h.droppedBefore ?? 0, true);
  new Float32Array(buf, PACKET_HEADER_BYTES, samples.length).set(samples);
  return buf;
}

/** The `audio_put_buffer` payload of a mono buffer. */
export function encodePutBuffer(bufferId: number, sampleRate: number, samples: Float32Array): Uint8Array {
  const out = new Uint8Array(PUT_BUFFER_HEADER_BYTES + samples.length * 4);
  const v = new DataView(out.buffer);
  PUT_BUFFER_MAGIC.forEach((b, i) => v.setUint8(i, b));
  v.setUint32(4, bufferId, true);
  v.setUint32(8, sampleRate, true);
  v.setUint32(12, samples.length, true);
  new Float32Array(out.buffer, PUT_BUFFER_HEADER_BYTES, samples.length).set(samples);
  return out;
}

/** Reads an `audio_put_buffer` payload (the fake engine and the tests). */
export function decodePutBuffer(bytes: Uint8Array): { bufferId: number; sampleRate: number; samples: Float32Array } {
  if (bytes.length < PUT_BUFFER_HEADER_BYTES) throw new WireError('too-short', 'put_buffer payload shorter than its header');
  if (PUT_BUFFER_MAGIC.some((b, i) => bytes[i] !== b)) throw new WireError('bad-kind', 'put_buffer magic is not SRB1');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = v.getUint32(12, true);
  if (bytes.length !== PUT_BUFFER_HEADER_BYTES + n * 4) throw new WireError('length-mismatch', 'put_buffer length does not match its frame count');
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = v.getFloat32(PUT_BUFFER_HEADER_BYTES + i * 4, true);
  return { bufferId: v.getUint32(4, true), sampleRate: v.getUint32(8, true), samples };
}

/** The `audio_decode` request: u32 bufferId, then the file bytes. */
export function encodeDecodeRequest(bufferId: number, file: ArrayBuffer): Uint8Array {
  const out = new Uint8Array(4 + file.byteLength);
  new DataView(out.buffer).setUint32(0, bufferId, true);
  out.set(new Uint8Array(file), 4);
  return out;
}

/** Reads the `audio_decode` request (the fake engine). */
export function decodeDecodeRequest(bytes: Uint8Array): { bufferId: number; file: Uint8Array } {
  if (bytes.length < 4) throw new WireError('too-short', 'decode request shorter than its id');
  return { bufferId: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true), file: bytes.subarray(4) };
}

/** Reads the `audio_decode` reply: u32 sampleRate, u32 nFrames, f32 samples (copied out of the reply). */
export function parseDecodeReply(buf: ArrayBuffer): { sampleRate: number; samples: Float32Array } {
  if (buf.byteLength < 8) throw new WireError('too-short', 'decode reply shorter than its header');
  const v = new DataView(buf);
  const n = v.getUint32(4, true);
  if (buf.byteLength !== 8 + n * 4) throw new WireError('length-mismatch', 'decode reply length does not match its frame count');
  return { sampleRate: v.getUint32(0, true), samples: new Float32Array(buf.slice(8)) };
}

/** Writes the `audio_decode` reply (the fake engine). */
export function encodeDecodeReply(sampleRate: number, samples: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(8 + samples.length * 4);
  const v = new DataView(buf);
  v.setUint32(0, sampleRate, true);
  v.setUint32(4, samples.length, true);
  new Float32Array(buf, 8, samples.length).set(samples);
  return buf;
}
