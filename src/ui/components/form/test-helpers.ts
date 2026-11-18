// Test-only helpers (not shipped). Sets a native control's value the way a user would, so React's
// onChange fires. Used by the D2a component tests.
import { act } from '../../primitives/test-render.ts';

export function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string, eventType: 'input' | 'change'): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) throw new Error('no value setter');
  setter.call(el, value);
  act(() => {
    el.dispatchEvent(new Event(eventType, { bubbles: true }));
  });
}

export function q<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

export function blur(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.blur();
  });
}
