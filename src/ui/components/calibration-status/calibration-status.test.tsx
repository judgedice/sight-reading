// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, click, mount, type Mounted } from '../../primitives/test-render.ts';
import { CalStatusPill, calTexts, type CalStatusView } from './index.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  document.body.innerHTML = '';
});
const m = (node: React.ReactNode): HTMLElement => {
  current = mount(node);
  return current.container;
};

const blank: CalStatusView = { state: 'none', output: null, oldOutput: null, when: null, ms: null, reason: null };
const ok: CalStatusView = { ...blank, state: 'ok', output: 'speakers', when: 'today', ms: 142 };
const none: CalStatusView = blank;
const changed: CalStatusView = { ...blank, state: 'changed', output: 'bluetooth', oldOutput: 'speakers' };
const failed: CalStatusView = { ...blank, state: 'failed', reason: 'error.clockRate' };

const pill = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('[data-testid="cal-status"]') as HTMLButtonElement;
const pop = () => document.querySelector('.ui-popover');

describe('calTexts', () => {
  it('words the four states', () => {
    expect(calTexts(ok).full).toBe('Calibrated for speakers · today');
    expect(calTexts(ok).short).toBe('Calibrated · today');
    expect(calTexts(ok).detail).toBe('Your setup adds 142 ms. We take it off every note, so early and late are fair.');
    expect(calTexts(none, 20)).toMatchObject({ full: 'Not calibrated', action: 'Calibrate' });
    expect(calTexts(none, 20).detail).toBe('Tries count as practice until you calibrate. It takes about 20 seconds.');
    expect(calTexts(changed)).toMatchObject({ full: 'Output changed to Bluetooth. Calibrate again', lead: 'Output changed to Bluetooth', action: 'Calibrate again' });
    expect(calTexts(changed).detail).toBe("You calibrated for speakers. Timing for Bluetooth isn't measured yet.");
    expect(calTexts(failed)).toMatchObject({ full: "Calibration didn't finish", action: 'Calibrate' });
    expect(calTexts(failed).detail.startsWith("Your device's audio clock")).toBe(true);
  });
  it('dates other than today and yesterday show the date', () => {
    expect(calTexts({ ...ok, when: { date: '2026-11-02' } }).full).toBe('Calibrated for speakers · 2026-11-02');
    expect(calTexts({ ...ok, when: 'yesterday' }).full).toBe('Calibrated for speakers · yesterday');
  });
});

describe('CalStatusPill', () => {
  it('only the changed state takes the caution tone (data-state is the styling hook)', () => {
    const tones = [ok, none, changed, failed].map((s) => {
      const c = m(<CalStatusPill status={s} variant="header" onCalibrate={() => undefined} />);
      const state = pill(c).dataset['state'];
      current?.unmount();
      current = null;
      return state;
    });
    expect(tones).toEqual(['ok', 'none', 'changed', 'failed']);
    const css = require_css();
    expect(css.match(/var\(--caution\)/g)?.length).toBeGreaterThan(0);
    // Every rule that uses the caution colour is under the changed state.
    for (const rule of css.split('}')) {
      if (rule.includes('--caution')) expect(rule).toContain("data-state='changed'");
    }
  });

  it('header: opens a popover with the detail and the action; Calibrate for none, Calibrate again for changed', () => {
    const onCalibrate = vi.fn();
    const c = m(<CalStatusPill status={none} variant="header" onCalibrate={onCalibrate} onSettings={() => undefined} />);
    expect(pop()).toBeNull();
    click(pill(c));
    expect(pop()?.textContent).toContain('It takes about 20 seconds.');
    const buttons = [...(pop()?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
    expect(buttons).toEqual(['Calibrate', 'Settings']);
    click(pop()?.querySelector('button') as HTMLElement);
    expect(onCalibrate).toHaveBeenCalledTimes(1);
    expect(pop()).toBeNull();

    current?.unmount();
    const c2 = m(<CalStatusPill status={changed} variant="header" onCalibrate={() => undefined} />);
    click(pill(c2));
    expect([...(pop()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Calibrate again']);
  });

  it('never opens by itself', () => {
    m(<CalStatusPill status={changed} variant="header" onCalibrate={() => undefined} />);
    expect(pop()).toBeNull();
  });

  it('the read-through popover adds the bring-you-back line', () => {
    const c = m(<CalStatusPill status={none} variant="header" readThrough onCalibrate={() => undefined} />);
    click(pill(c));
    expect(pop()?.textContent).toContain("We'll bring you back to this music after.");
  });

  it('the narrow header shortens the calibrated text', () => {
    const c = m(<CalStatusPill status={ok} variant="header" short onCalibrate={() => undefined} />);
    expect(pill(c).textContent).toBe('Calibrated · today');
  });

  it('line: text with a link, and no link when calibrated', () => {
    const onCalibrate = vi.fn();
    const c = m(<CalStatusPill status={changed} variant="line" onCalibrate={onCalibrate} />);
    expect(c.textContent).toBe('Output changed to Bluetooth·Calibrate again');
    act(() => c.querySelector('button')?.click());
    expect(onCalibrate).toHaveBeenCalled();
    current?.unmount();
    const c2 = m(<CalStatusPill status={ok} variant="line" onCalibrate={onCalibrate} />);
    expect(c2.querySelector('button')).toBeNull();
    expect(c2.textContent).toBe('Calibrated for speakers · today');
    current?.unmount();
    const c3 = m(<CalStatusPill status={none} variant="line" onCalibrate={onCalibrate} />);
    expect(c3.textContent).toBe('Not calibrated' + 'Calibrate');
  });

  it('card-row: a button row with the action word, and a chevron', () => {
    const c = m(<CalStatusPill status={failed} variant="card-row" onCalibrate={() => undefined} />);
    expect(pill(c).textContent).toBe("Calibration didn't finishCalibrate");
    expect(pill(c).getAttribute('aria-haspopup')).toBe('dialog');
    current?.unmount();
    const c2 = m(<CalStatusPill status={ok} variant="card-row" onCalibrate={() => undefined} />);
    expect(pill(c2).textContent).toBe('Calibrated for speakers · today');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
function require_css(): string {
  return readFileSync(join(process.cwd(), 'src/ui/components/calibration-status/cal-status.css'), 'utf8');
}
