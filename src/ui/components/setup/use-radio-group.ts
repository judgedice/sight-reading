import { useCallback, useRef, type KeyboardEvent } from 'react';

export interface RadioItemProps {
  ref: (el: HTMLElement | null) => void;
  tabIndex: number;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onClick: () => void;
}

/**
 * Roving focus for a radio group of `role="radio"` buttons (05 section 14.3): one Tab stop (the selected option, else
 * the first), arrow keys move and select, Home and End jump, click, tap, Enter and Space select. A blocked option
 * (`aria-disabled`) still takes focus, so its reason is read, but is never selected.
 */
export function useRadioGroup(count: number, selected: number, blocked: (index: number) => boolean, onSelect: (index: number) => void) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const stop = selected >= 0 && selected < count ? selected : 0;

  const move = useCallback(
    (to: number) => {
      refs.current[to]?.focus();
      if (!blocked(to)) onSelect(to);
    },
    [blocked, onSelect],
  );

  return (index: number): RadioItemProps => ({
    ref: (el) => {
      refs.current[index] = el;
    },
    tabIndex: index === stop ? 0 : -1,
    onKeyDown: (event) => {
      let to: number | null = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') to = (index + 1) % count;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') to = (index - 1 + count) % count;
      else if (event.key === 'Home') to = 0;
      else if (event.key === 'End') to = count - 1;
      if (to === null) return;
      event.preventDefault();
      move(to);
    },
    onClick: () => {
      if (!blocked(index)) onSelect(index);
    },
  });
}
