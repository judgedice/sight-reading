import { describe, expect, it } from 'vitest';
import { appliedProcessingOf, fnv1a, inputKindOf, routeKeyOf } from './route.ts';

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
    ['iPhone Microphone', 'built-in'],
    ['Default - Microphone Array (Realtek)', 'built-in'],
    ['', 'unknown'],
    ['Mystery Box', 'unknown'],
  ] as const)('classifies %j as %s (W8)', (label, kind) => {
    expect(inputKindOf(label)).toBe(kind);
  });

  it('reads back applied processing; unreported is null (W5)', () => {
    expect(appliedProcessingOf({ echoCancellation: true, noiseSuppression: false })).toEqual({ echoCancellation: true, noiseSuppression: false, autoGainControl: null });
    expect(appliedProcessingOf({ echoCancellation: 'none' })).toEqual({ echoCancellation: false, noiseSuppression: null, autoGainControl: null });
    expect(appliedProcessingOf({ echoCancellation: 'all' }).echoCancellation).toBe(true);
  });
});
