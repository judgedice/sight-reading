/**
 * Minimal WAV reader and writer for the testkit (01 section 14 item 12).
 *
 * Writes RIFF/WAVE with PCM 16-bit (default, what the reference WAVs use and what Chromium's
 * `--use-file-for-fake-audio-capture` reads) or IEEE float 32-bit (lossless for Float32 data).
 * Reads PCM 8/16/24/32-bit and float 32/64-bit, skipping unknown chunks. Pure and deterministic.
 */

export type WavFormat = 'pcm16' | 'float32';

export interface WavData {
  sampleRate: number;
  /** One Float32Array per channel, samples in [-1, 1]. */
  channels: Float32Array[];
}

export interface WavEncodeOptions {
  format?: WavFormat;
}

/** Quantise a float sample to a signed 16-bit integer (round half away from zero, clamped). */
export function floatToPcm16(x: number): number {
  const c = x > 1 ? 1 : x < -1 ? -1 : x;
  const v = Math.round(c * 32768);
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v;
}

/** Inverse of `floatToPcm16`: exact in Float32. */
export function pcm16ToFloat(v: number): number {
  return v / 32768;
}

/** Encode PCM data (mono or multi-channel, equal lengths) to WAV bytes. */
export function encodeWav(data: WavData, opts: WavEncodeOptions = {}): Uint8Array {
  const format = opts.format ?? 'pcm16';
  const nch = data.channels.length;
  if (nch < 1) throw new RangeError('encodeWav: at least one channel is required');
  const n = data.channels[0]?.length ?? 0;
  for (const ch of data.channels) {
    if (ch.length !== n) throw new RangeError('encodeWav: channels must have equal length');
  }
  if (!Number.isInteger(data.sampleRate) || data.sampleRate <= 0) {
    throw new RangeError(`encodeWav: sampleRate must be a positive integer, got ${data.sampleRate}`);
  }
  const bytesPer = format === 'pcm16' ? 2 : 4;
  const dataBytes = n * nch * bytesPer;
  const fmtExtra = format === 'float32' ? 2 : 0; // cbSize for the non-PCM format tag
  const fmtSize = 16 + fmtExtra;
  const total = 12 + 8 + fmtSize + (format === 'float32' ? 8 + 4 : 0) + 8 + dataBytes + (dataBytes % 2);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  const tag = (s: string): void => {
    for (let i = 0; i < 4; i++) out[p++] = s.charCodeAt(i);
  };
  tag('RIFF');
  dv.setUint32(p, total - 8, true);
  p += 4;
  tag('WAVE');
  tag('fmt ');
  dv.setUint32(p, fmtSize, true);
  p += 4;
  dv.setUint16(p, format === 'pcm16' ? 1 : 3, true);
  p += 2;
  dv.setUint16(p, nch, true);
  p += 2;
  dv.setUint32(p, data.sampleRate, true);
  p += 4;
  dv.setUint32(p, data.sampleRate * nch * bytesPer, true);
  p += 4;
  dv.setUint16(p, nch * bytesPer, true);
  p += 2;
  dv.setUint16(p, bytesPer * 8, true);
  p += 2;
  if (fmtExtra) {
    dv.setUint16(p, 0, true);
    p += 2;
    // 'fact' chunk is required for non-PCM formats.
    tag('fact');
    dv.setUint32(p, 4, true);
    p += 4;
    dv.setUint32(p, n, true);
    p += 4;
  }
  tag('data');
  dv.setUint32(p, dataBytes, true);
  p += 4;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const x = (data.channels[c] as Float32Array)[i] as number;
      if (format === 'pcm16') {
        dv.setInt16(p, floatToPcm16(x), true);
        p += 2;
      } else {
        dv.setFloat32(p, x, true);
        p += 4;
      }
    }
  }
  return out;
}

/** Decode WAV bytes. Throws on anything that is not a supported RIFF/WAVE file. */
export function decodeWav(bytes: Uint8Array): WavData {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o: number): string => String.fromCharCode(bytes[o] ?? 0, bytes[o + 1] ?? 0, bytes[o + 2] ?? 0, bytes[o + 3] ?? 0);
  if (bytes.length < 12 || str(0) !== 'RIFF' || str(8) !== 'WAVE') throw new Error('decodeWav: not a RIFF/WAVE file');
  let p = 12;
  let fmt: { tag: number; nch: number; rate: number; bits: number } | null = null;
  let dataStart = -1;
  let dataLen = 0;
  while (p + 8 <= bytes.length) {
    const id = str(p);
    const size = dv.getUint32(p + 4, true);
    const body = p + 8;
    if (id === 'fmt ') {
      let tagv = dv.getUint16(body, true);
      if (tagv === 0xfffe && size >= 26) tagv = dv.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE sub-format
      fmt = { tag: tagv, nch: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === 'data') {
      dataStart = body;
      dataLen = Math.min(size, bytes.length - body);
      break;
    }
    p = body + size + (size % 2);
  }
  if (!fmt) throw new Error('decodeWav: missing fmt chunk');
  if (dataStart < 0) throw new Error('decodeWav: missing data chunk');
  const { tag: ftag, nch, rate, bits } = fmt;
  if (nch < 1) throw new Error('decodeWav: zero channels');
  const bytesPer = bits / 8;
  const isFloat = ftag === 3;
  const supported = isFloat ? bits === 32 || bits === 64 : ftag === 1 && (bits === 8 || bits === 16 || bits === 24 || bits === 32);
  if (!supported) throw new Error(`decodeWav: unsupported format tag ${ftag} with ${bits} bits`);
  const frames = Math.floor(dataLen / (bytesPer * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  let q = dataStart;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      let v: number;
      if (isFloat) v = bits === 32 ? dv.getFloat32(q, true) : dv.getFloat64(q, true);
      else if (bits === 8) v = ((dv.getUint8(q) as number) - 128) / 128;
      else if (bits === 16) v = dv.getInt16(q, true) / 32768;
      else if (bits === 24) v = (((dv.getUint8(q) | (dv.getUint8(q + 1) << 8) | (dv.getUint8(q + 2) << 16)) << 8) >> 8) / 8388608;
      else v = dv.getInt32(q, true) / 2147483648;
      (channels[c] as Float32Array)[i] = v;
      q += bytesPer;
    }
  }
  return { sampleRate: rate, channels };
}

/** Downmix to mono by averaging channels (a single channel is returned as is). */
export function toMono(data: WavData): Float32Array {
  if (data.channels.length === 1) return data.channels[0] as Float32Array;
  const n = data.channels[0]?.length ?? 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const ch of data.channels) s += ch[i] as number;
    out[i] = s / data.channels.length;
  }
  return out;
}
