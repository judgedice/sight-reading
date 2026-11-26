import { describe, expect, it } from 'vitest';
import grading from '../../config/grading-config.json';
import { bluetoothLabelMatches, delayMatters, handsFreeSignature } from './bluetooth-evidence.ts';
import { MAC_BUILT_IN } from './bluetooth-evidence.fixtures.ts';

const maxRtlMs = grading.ranked.maxRtlMs;

describe('Bluetooth evidence (round 3, Bluetooth false positive)', () => {
  it('Bluetooth labels match: AirPods, Bluetooth, Beats, Hands-Free, HFP, BT', () => {
    for (const l of ['AirPods Pro', 'Bluetooth Headphones', 'Beats Studio Buds', 'Headset (WH-1000XM4 Hands-Free AG Audio)', 'Hands Free', 'handsfree', 'HFP mic', 'Jabra BT', 'BT-Speaker', 'BLUETOOTH']) {
      expect(bluetoothLabelMatches(l), l).toBe(true);
    }
  });

  it('built-in, wired and USB labels do not, nor does "headset" alone or "bt" inside a word', () => {
    for (const l of ['MacBook Pro Microphone', 'Default - MacBook Air Microphone (Built-in)', 'MacBook Pro Speakers', 'iPhone Microphone', 'External Microphone', 'Headset Microphone', 'USB Headset', 'Subtle Mic', 'Rbt9', '', null, undefined]) {
      expect(bluetoothLabelMatches(l), String(l)).toBe(false);
    }
  });

  it('hands-free signature: an 8 or 16 kHz track only together with a label change', () => {
    expect(handsFreeSignature(16000, true)).toBe(true);
    expect(handsFreeSignature(8000, true)).toBe(true);
    expect(handsFreeSignature(16000, false)).toBe(false);
    expect(handsFreeSignature(48000, true)).toBe(false);
    expect(handsFreeSignature(null, true)).toBe(false);
  });

  it('the delay matters only above the ranked ceiling', () => {
    expect(maxRtlMs).toBe(120);
    expect(delayMatters(120, maxRtlMs)).toBe(false);
    expect(delayMatters(120.5, maxRtlMs)).toBe(true);
    expect(delayMatters(null, maxRtlMs)).toBe(false);
    expect(delayMatters(Number.NaN, maxRtlMs)).toBe(false);
  });

  it("the owner's MacBook numbers carry no Bluetooth evidence and no delay that matters", () => {
    for (const ms of [MAC_BUILT_IN.loopback.roundTripMs, ...MAC_BUILT_IN.rechecksMs, MAC_BUILT_IN.selfTestLoopback.rtlMs]) {
      expect(delayMatters(ms, maxRtlMs), String(ms)).toBe(false);
    }
    expect(handsFreeSignature(MAC_BUILT_IN.contextSampleRate, false)).toBe(false);
  });
});
