// Shared behaviour of sheets, modals and popovers (04 section 5.10, 8.1 item 2.1.2, 8.3):
// Esc closes the topmost overlay only, modal overlays trap Tab and restore focus on close.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Tabbable descendants of a container, in DOM order, skipping hidden ones. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true' && !el.hasAttribute('hidden') && !el.closest('[hidden]'),
  );
}

/** Where focus goes when an overlay opens: [data-autofocus], else the first tabbable, else the container. */
export function focusInitial(container: HTMLElement): void {
  const preferred = container.querySelector<HTMLElement>('[data-autofocus]');
  const target = preferred ?? focusableWithin(container)[0] ?? container;
  target.focus();
}

/** Keeps Tab and Shift+Tab inside the container. Returns true when it handled the event. */
export function trapTab(event: KeyboardEvent, container: HTMLElement): boolean {
  if (event.key !== 'Tab') return false;
  const items = focusableWithin(container);
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return true;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!first || !last) return false;
  if (!container.contains(active) || active === container) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/** Open overlays, bottom to top. Only the topmost reacts to Esc. */
const stack: symbol[] = [];

export function pushOverlay(id: symbol): void {
  stack.push(id);
}

export function removeOverlay(id: symbol): void {
  const i = stack.indexOf(id);
  if (i >= 0) stack.splice(i, 1);
}

export function isTopOverlay(id: symbol): boolean {
  return stack[stack.length - 1] === id;
}

/** Number of open overlays; used by tests and by callers that must not stack a second sheet. */
export function openOverlayCount(): number {
  return stack.length;
}
