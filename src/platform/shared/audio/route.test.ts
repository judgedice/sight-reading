import { describe, expect, it } from 'vitest';
import { appliedProcessingOf, fnv1a, inputKindOf, legacyRouteKeyOf, normalizeInputLabel, routeKeyAliasesOf, routeKeyOf } from './route.ts';

describe('route identity', () => {
  it('hashes the route stably and changes with each component (01 §5.2)', () => {
    const k = routeKeyOf('MacBook Pro Microphone', 'speakers', 48000, 'macos');
    expect(k).toBe(routeKeyOf('MacBook Pro Microphone', 'speakers', 48000, 'macos'));
    expect(k).toMatch(/^r-[0-9a-f]{8}$/);
    expect(new Set([
      k,
      routeKeyOf('MacBook Pro Microphone', 'wired', 48000, 'macos'),
      routeKeyOf('MacBook Pro Microphone', 'speakers', 44100, 'macos'),
      routeKeyOf('MacBook Pro Microphone', 'speakers', 48000, 'ios'),
      routeKeyOf('USB Audio Interface', 'speakers', 48000, 'macos'),
    ]).size).toBe(5);
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
  });

  it.each([
    ['AirPods Pro', 'bluetooth'],
    ['Bose QC Headset (Bluetooth)', 'bluetooth'],
    ['Hands-Free AG Audio', 'bluetooth'],
    ['Scarlett 2i2 USB', 'usb-interface'],
    ['External Microphone', 'wired'],
    ['Headphones (wired)', 'wired'],
    ['MacBook Pro Microphone', 'built-in'],
    ['Default - MacBook Pro Microphone (Built-in)', 'built-in'],
    ['MacBook Air Speakers', 'built-in'],
    ['Jabra Evolve2 BT', 'bluetooth'],
    ['Headset Microphone', 'unknown'],
    ['iPhone Microphone', 'built-in'],
    ['Default - Microphone Array (Realtek)', 'built-in'],
    ['', 'unknown'],
    ['Mystery Box', 'unknown'],
  ] as const)('classifies %j as %s (W8)', (label, kind) => {
    expect(inputKindOf(label)).toBe(kind);
  });

  it('hands-free signature: an 8 or 16 kHz track after a label change is Bluetooth; a low rate alone is not (round 3)', () => {
    expect(inputKindOf('Headset Microphone', { trackSampleRate: 16000, labelChanged: true })).toBe('bluetooth');
    expect(inputKindOf('Mystery Box', { trackSampleRate: 8000, labelChanged: true })).toBe('bluetooth');
    expect(inputKindOf('Mystery Box', { trackSampleRate: 16000, labelChanged: false })).toBe('unknown');
    expect(inputKindOf('MacBook Pro Microphone', { trackSampleRate: 48000, labelChanged: true })).toBe('built-in');
    expect(inputKindOf('', { trackSampleRate: null, labelChanged: false })).toBe('unknown');
  });

  it('reads back applied processing; unreported is null (W5)', () => {
    expect(appliedProcessingOf({ echoCancellation: true, noiseSuppression: false })).toEqual({ echoCancellation: true, noiseSuppression: false, autoGainControl: null });
    expect(appliedProcessingOf({ echoCancellation: 'none' })).toEqual({ echoCancellation: false, noiseSuppression: null, autoGainControl: null });
    expect(appliedProcessingOf({ echoCancellation: 'all' }).echoCancellation).toBe(true);
  });
});

describe('route key under Chrome virtual-device label prefixes (round 2, cause 5)', () => {
  const PLAIN = 'MacBook Pro Microphone (Built-in)';
  const args = ['speakers', 48000, 'macos'] as const;

  it('old behaviour: the prefix changed the key, so a calibration under one label did not apply under another', () => {
    const before = (l: string) => legacyRouteKeyOf(l, ...args);
    expect(before(`Default - ${PLAIN}`)).not.toBe(before(PLAIN));
    expect(before(`Communications - ${PLAIN}`)).not.toBe(before(PLAIN));
  });

  it('fix: the same microphone gets one key whatever prefix Chrome puts on it', () => {
    const k = routeKeyOf(PLAIN, ...args);
    expect(routeKeyOf(`Default - ${PLAIN}`, ...args)).toBe(k);
    expect(routeKeyOf(`Communications - ${PLAIN}`, ...args)).toBe(k);
    expect(routeKeyOf(`default - ${PLAIN}`, ...args)).toBe(k);
  });

  it('a different microphone, output, rate or platform still gets a different key', () => {
    const k = routeKeyOf(`Default - ${PLAIN}`, ...args);
    expect(routeKeyOf('Default - AirPods Pro', ...args)).not.toBe(k);
    expect(routeKeyOf(`Default - ${PLAIN}`, 'wired', 48000, 'macos')).not.toBe(k);
    expect(routeKeyOf(`Default - ${PLAIN}`, 'speakers', 44100, 'macos')).not.toBe(k);
  });

  it('strips one leading prefix only, and leaves other text alone', () => {
    expect(normalizeInputLabel('Default - Default - X')).toBe('Default - X');
    expect(normalizeInputLabel('My Default - Mic')).toBe('My Default - Mic');
    expect(normalizeInputLabel('')).toBe('');
  });

  it('old keys stay readable: the aliases of the plain label include the key the old code made for "Default - <label>"', () => {
    const oldDefault = legacyRouteKeyOf(`Default - ${PLAIN}`, ...args);
    const oldComms = legacyRouteKeyOf(`Communications - ${PLAIN}`, ...args);
    const oldPlain = legacyRouteKeyOf(PLAIN, ...args);
    for (const label of [PLAIN, `Default - ${PLAIN}`, `Communications - ${PLAIN}`]) {
      const aliases = routeKeyAliasesOf(label, ...args);
      expect(aliases[0]).toBe(routeKeyOf(label, ...args));
      expect(aliases).toEqual(expect.arrayContaining([oldDefault, oldComms, oldPlain]));
      expect(new Set(aliases).size).toBe(aliases.length);
    }
  });
});
