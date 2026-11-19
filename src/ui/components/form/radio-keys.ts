import type { KeyboardEvent } from 'react';

/**
 * Home and End for a group of native radio inputs (05 section 14 item 3). Browsers move and select with the arrow keys
 * but ignore Home and End on native radios, so the group's container forwards them: focus and select the first or
 * last enabled radio. Disabled radios are skipped.
 */
export function radioGroupHomeEnd(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Home' && event.key !== 'End') return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'radio') return;
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => !r.disabled);
  const to = event.key === 'Home' ? radios[0] : radios[radios.length - 1];
  if (!to) return;
  event.preventDefault();
  to.focus();
  if (!to.checked) to.click();
}
