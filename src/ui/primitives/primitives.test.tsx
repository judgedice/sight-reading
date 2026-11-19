// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal.tsx';
import { Popover } from './Popover.tsx';
import { Sheet } from './Sheet.tsx';
import { ToastProvider, useToast } from './Toast.tsx';
import { openOverlayCount } from './overlay-stack.ts';
import { act, click, key, mount, type Mounted } from './test-render.ts';

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  document.body.innerHTML = '';
});

function ModalHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        {'open'}
      </button>
      <Modal
        open={open}
        title="T"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <button type="button" data-testid="a">
          {'a'}
        </button>
        <button type="button" data-testid="b" data-autofocus>
          {'b'}
        </button>
      </Modal>
    </div>
  );
}

const q = (sel: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

describe('Modal', () => {
  it('focuses [data-autofocus], traps Tab, closes on Esc and restores focus', () => {
    const onClose = vi.fn();
    current = mount(<ModalHarness onClose={onClose} />);
    const opener = q('[data-testid=opener]');
    opener.focus();
    click(opener);
    const dialog = q('[role=dialog]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement).toBe(q('[data-testid=b]'));
    expect(openOverlayCount()).toBe(1);

    // Tab from the last tabbable wraps to the first (the close button).
    const tabs = Array.from(dialog.querySelectorAll<HTMLElement>('button'));
    const last = tabs[tabs.length - 1]!;
    last.focus();
    key(last, 'Tab');
    expect(document.activeElement).toBe(tabs[0]);
    key(tabs[0]!, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(last);

    key(document.activeElement ?? document.body, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(openOverlayCount()).toBe(0);
  });

  it('closes on a scrim click and renders no close button without onClose', () => {
    const onClose = vi.fn();
    current = mount(
      <Modal open title="T" onClose={onClose}>
        {'x'}
      </Modal>,
    );
    click(q('[data-testid=modal-scrim]'));
    expect(onClose).toHaveBeenCalledTimes(1);
    current.render(
      <Modal open title="T">
        {'x'}
      </Modal>,
    );
    expect(document.querySelectorAll('.ui-icon-button')).toHaveLength(0);
    key(document, 'Escape');
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
  });

  it('only the topmost overlay handles Esc', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    current = mount(
      <>
        <Modal open title="outer" onClose={outer}>
          {'o'}
        </Modal>
        <Modal open title="inner" onClose={inner}>
          {'i'}
        </Modal>
      </>,
    );
    key(document, 'Escape');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('Sheet', () => {
  it('renders a bottom or right sheet as a labelled modal dialog', () => {
    const onClose = vi.fn();
    current = mount(
      <Sheet open title="S" side="right" onClose={onClose}>
        <button type="button">{'in'}</button>
      </Sheet>,
    );
    expect(q('.ui-sheet').className).toContain('ui-sheet-right');
    expect(q('[role=dialog]').getAttribute('aria-modal')).toBe('true');
    key(document, 'Escape');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a non-modal peek strip until expanded', () => {
    function Harness() {
      const [expanded, setExpanded] = useState(false);
      return (
        <Sheet open title="S" peek={<span>{'peek'}</span>} expanded={expanded} onExpandedChange={setExpanded}>
          {'body'}
        </Sheet>
      );
    }
    current = mount(<Harness />);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(openOverlayCount()).toBe(0);
    click(q('.ui-sheet-peek-button'));
    expect(q('[role=dialog]')).toBeTruthy();
    click(q('.ui-icon-button'));
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
});

describe('Popover', () => {
  it('opens next to its anchor without taking focus and closes on Esc', () => {
    const onClose = vi.fn();
    function Harness() {
      const ref = useRef<HTMLButtonElement>(null);
      const [anchor, setAnchor] = useState<HTMLElement | null>(null);
      return (
        <>
          <button
            type="button"
            ref={(el) => {
              (ref as { current: HTMLButtonElement | null }).current = el;
              if (el !== anchor) setAnchor(el);
            }}
          >
            {'anchor'}
          </button>
          <Popover open anchor={anchor} label="P" onClose={onClose}>
            {'hello'}
          </Popover>
        </>
      );
    }
    current = mount(<Harness />);
    const pop = q('.ui-popover');
    expect(pop.getAttribute('aria-label')).toBe('P');
    expect(document.activeElement).not.toBe(pop);
    key(document, 'Escape');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Toast', () => {
  function Trigger() {
    const toast = useToast();
    return (
      <button type="button" data-testid="go" onClick={() => toast.show({ text: 'Saved', action: { label: 'Undo', onAction: () => undefined } })}>
        {'go'}
      </button>
    );
  }

  it('shows for 6 seconds in a polite live region', () => {
    vi.useFakeTimers();
    try {
      current = mount(
        <ToastProvider>
          <Trigger />
        </ToastProvider>,
      );
      const region = q('.ui-toast-region');
      expect(region.getAttribute('aria-live')).toBe('polite');
      click(q('[data-testid=go]'));
      expect(region.textContent).toContain('Saved');
      act(() => {
        vi.advanceTimersByTime(5900);
      });
      expect(region.textContent).toContain('Saved');
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(region.textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows nothing while suppressed and clears a toast already showing', () => {
    current = mount(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    click(q('[data-testid=go]'));
    expect(q('.ui-toast-region').textContent).toContain('Saved');
    current.render(
      <ToastProvider suppressed>
        <Trigger />
      </ToastProvider>,
    );
    expect(q('.ui-toast-region').textContent).toBe('');
    click(q('[data-testid=go]'));
    expect(q('.ui-toast-region').textContent).toBe('');
  });
});
