// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INFO_HOVER_DELAY_MS, InfoButton } from './InfoButton.tsx';
import { Sheet, SHEET_SWIPE_DISTANCE } from './Sheet.tsx';
import { Modal } from './Modal.tsx';
import { act, click, key, mount, type Mounted } from './test-render.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const q = (sel: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

function pointer(el: Element, type: string, init: { pointerType?: string; clientY?: number } = {}): void {
  const event = new MouseEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave', cancelable: true, clientY: init.clientY ?? 0 });
  Object.defineProperty(event, 'pointerType', { value: init.pointerType ?? 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    el.dispatchEvent(event);
  });
}

function stubPointer(fine: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: fine && query.includes('pointer: fine'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

function mountInfo(): HTMLElement {
  current = mount(
    <InfoButton control="Hear starting pitch" title="What is the reference?">
      {'Body text'}
    </InfoButton>,
  );
  return q('.ui-info-button');
}

describe('InfoButton and popover', () => {
  it('has aria-expanded and aria-controls and a name built from the control', () => {
    const button = mountInfo();
    expect(button.getAttribute('aria-label')).toBe('About Hear starting pitch');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const popover = q('.ui-popover');
    expect(button.getAttribute('aria-controls')).toBe(popover.id);
    expect(popover.querySelector('.ui-popover-title')?.textContent).toBe('What is the reference?');
    expect(popover.textContent).toContain('Body text');
  });

  it('opens after a 400 ms hover with a fine pointer and closes on leave', () => {
    vi.useFakeTimers();
    stubPointer(true);
    const button = mountInfo();
    pointer(button, 'pointerenter', { pointerType: 'mouse' });
    act(() => void vi.advanceTimersByTime(INFO_HOVER_DELAY_MS - 10));
    expect(document.querySelector('.ui-popover')).toBeNull();
    act(() => void vi.advanceTimersByTime(20));
    expect(document.querySelector('.ui-popover')).not.toBeNull();
    pointer(button, 'pointerleave', { pointerType: 'mouse' });
    act(() => void vi.advanceTimersByTime(300));
    expect(document.querySelector('.ui-popover')).toBeNull();
  });

  it('does not open on hover with a touch or coarse pointer; a press opens it', () => {
    vi.useFakeTimers();
    stubPointer(false);
    const button = mountInfo();
    pointer(button, 'pointerenter', { pointerType: 'touch' });
    act(() => void vi.advanceTimersByTime(1000));
    expect(document.querySelector('.ui-popover')).toBeNull();
    pointer(button, 'pointerenter', { pointerType: 'mouse' });
    act(() => void vi.advanceTimersByTime(1000));
    expect(document.querySelector('.ui-popover')).toBeNull();
    click(button);
    expect(document.querySelector('.ui-popover')).not.toBeNull();
  });

  it('a press pins the popover: leaving does not close it, a second press does', () => {
    vi.useFakeTimers();
    stubPointer(true);
    const button = mountInfo();
    click(button);
    pointer(button, 'pointerleave', { pointerType: 'mouse' });
    act(() => void vi.advanceTimersByTime(1000));
    expect(document.querySelector('.ui-popover')).not.toBeNull();
    click(button);
    expect(document.querySelector('.ui-popover')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape closes it and returns focus to the button', () => {
    const button = mountInfo();
    click(button);
    q('.ui-popover').focus();
    key(document, 'Escape');
    expect(document.querySelector('.ui-popover')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('a press outside closes a pinned popover', () => {
    const button = mountInfo();
    click(button);
    pointer(document.body, 'pointerdown');
    expect(document.querySelector('.ui-popover')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('a press inside the popover keeps it open', () => {
    const button = mountInfo();
    click(button);
    pointer(q('.ui-popover'), 'pointerdown');
    expect(document.querySelector('.ui-popover')).not.toBeNull();
  });
});

describe('Sheet grabber, swipe and scrim', () => {
  it('renders a grabber and a Done button that calls onDone', () => {
    const onDone = vi.fn();
    current = mount(
      <Sheet open title="Setup" onCancel={() => undefined} onDone={onDone}>
        {'x'}
      </Sheet>,
    );
    expect(document.querySelector('.ui-sheet-grabber')).not.toBeNull();
    const done = q('.ui-sheet-head .ui-button-primary');
    expect(done.textContent).toBe('Done');
    click(done);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('swipe down past the threshold calls cancel; a short drag does not', () => {
    const onCancel = vi.fn();
    current = mount(
      <Sheet open title="Setup" onCancel={onCancel}>
        {'x'}
      </Sheet>,
    );
    const grabber = q('[data-testid=sheet-grabber]');
    pointer(grabber, 'pointerdown', { clientY: 100 });
    pointer(grabber, 'pointermove', { clientY: 100 + SHEET_SWIPE_DISTANCE / 2 });
    pointer(grabber, 'pointerup', { clientY: 100 + SHEET_SWIPE_DISTANCE / 2 });
    expect(onCancel).not.toHaveBeenCalled();
    pointer(grabber, 'pointerdown', { clientY: 100 });
    pointer(grabber, 'pointermove', { clientY: 100 + SHEET_SWIPE_DISTANCE + 10 });
    pointer(grabber, 'pointerup', { clientY: 100 + SHEET_SWIPE_DISTANCE + 10 });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a scrim tap and Escape both call cancel', () => {
    const onCancel = vi.fn();
    current = mount(
      <Sheet open title="Setup" onCancel={onCancel}>
        {'x'}
      </Sheet>,
    );
    click(q('[data-testid=sheet-scrim]'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    key(document, 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe('Modal sizes and fixed foot', () => {
  it.each([
    ['confirm', 'ui-modal-confirm'],
    ['picker', 'ui-modal-picker'],
  ] as const)('size %s sets %s', (size, className) => {
    current = mount(
      <Modal open title="T" size={size} footer={<button type="button">{'ok'}</button>}>
        {'body'}
      </Modal>,
    );
    expect(q('.ui-modal').classList.contains(className)).toBe(true);
    expect(q('[data-testid=modal-foot]').parentElement).toBe(q('.ui-modal'));
    expect(q('.ui-modal-body').parentElement).toBe(q('.ui-modal'));
  });
});
