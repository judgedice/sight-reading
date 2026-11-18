// Test helper (not shipped): mounts React into jsdom with act() semantics, no testing-library needed.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLElement;
  root: Root;
  render: (node: ReactNode) => void;
  unmount: () => void;
}

export function mount(node: ReactNode): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (n: ReactNode): void => {
    act(() => root.render(n));
  };
  render(node);
  return {
    container,
    root,
    render,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export function click(el: Element): void {
  act(() => {
    (el as HTMLElement).click();
  });
}

export function key(target: Element | Document, k: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

export { act };
