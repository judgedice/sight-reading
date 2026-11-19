// Page probes for the accessibility and design QA specs. Shared probes (axe, tap targets, moving animations) come from
// e2e/design/helpers.ts.
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export { axeSeriousViolations, go, movingAnimations, smallTargets } from '../design/helpers.ts';

export const wavFor = (projectName: string): string => join(process.cwd(), 'test-results', 'a11y-e2e', `${projectName}.wav`);

export const isHighContrast = (projectName: string): boolean => /-hc/.test(projectName);
export const isReduced = (projectName: string): boolean => /-reduced$/.test(projectName);
export const isPhone = (projectName: string): boolean => /^p\d+/.test(projectName);

/** Forces data-contrast="high" on <html> from the first paint and re-asserts it if the app clears it. */
export async function forceHighContrast(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const set = (): void => {
      const root = document.documentElement;
      if (root && root.getAttribute('data-contrast') !== 'high') root.setAttribute('data-contrast', 'high');
    };
    new MutationObserver(set).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-contrast'] });
    set();
  });
}

/** Elements whose text is data the player or the corpus supplied (a piece's title and composer, a device name), not copy, and decorative text hidden from assistive technology (the letter chips in the STARS list). */
const DATA_SELECTORS = '.hist-credit, .hist-attempt-title, option, input, textarea, [data-user-text], [aria-hidden="true"]';

/**
 * Visible text blocks: the painted text of each block-level box, with the text of its inline children joined in
 * (so "Choosing Any: " and the bold "+24% XP" read as one string, the way the catalogue holds them).
 */
export async function visibleTextRuns(page: Page): Promise<{ text: string; where: string }[]> {
  return page.evaluate((dataSelectors) => {
    const blocks = new Map<Element, string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const raw = n.nodeValue ?? '';
      if (!raw.trim()) {
        // Whitespace between inline siblings belongs to the block's text.
        const p = n.parentElement;
        if (p && blocks.size > 0 && getComputedStyle(p).display === 'inline') {
          let b: Element | null = p;
          while (b && ['inline', 'contents'].includes(getComputedStyle(b).display)) b = b.parentElement;
          if (b && blocks.has(b)) blocks.set(b, `${blocks.get(b)} `);
        }
        continue;
      }
      const el = n.parentElement;
      if (!el || el.closest('script, style, noscript, template, [hidden], [inert]')) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (el.closest('.ui-visually-hidden, .sr-only')) continue;
      if (el.closest(dataSelectors)) continue;
      let block: Element | null = el;
      while (block && ['inline', 'contents'].includes(getComputedStyle(block).display)) block = block.parentElement;
      if (!block) continue;
      // Text a stylesheet adds around an inline element (the "·" before "bars show sounding pitch") and the gap after a key cap.
      const before = getComputedStyle(el, '::before').content;
      const after = getComputedStyle(el, '::after').content;
      const pseudo = (c: string): string => (/^["'].+["']$/.test(c) ? c.slice(1, -1) : '');
      const sep = el.closest('kbd') ? ' ' : '';
      blocks.set(block, `${blocks.get(block) ?? ''}${pseudo(before)}${raw.replace(/\s+/g, ' ')}${pseudo(after)}${sep}`);
    }
    return [...blocks.entries()]
      .map(([b, t]) => ({ text: t.replace(/\s+/g, ' ').trim(), where: `${b.tagName.toLowerCase()}.${String(b.className).split(' ')[0] ?? ''}` }))
      .filter((r) => r.text);
  }, DATA_SELECTORS);
}

/** Assistive names that are also user-facing words: aria-label and title of visible elements. */
export async function accessibleLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[aria-label], [title]'))) {
      if (el.closest('[hidden], [inert]')) continue;
      for (const a of ['aria-label', 'title']) {
        const v = el.getAttribute(a);
        if (v && v.trim()) out.push(v.replace(/\s+/g, ' ').trim());
      }
    }
    return out;
  });
}

/**
 * Controls that are disabled (the `disabled` attribute or aria-disabled="true") and show no reason: the reason is the
 * visible text of an element named by aria-describedby, or the visible text of a sibling or an ancestor row's hint
 * marked data-reason. A control inside a disabled group inherits the group's reason.
 */
export async function disabledWithoutReason(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visible = (el: Element | null): boolean => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 1 && r.height > 1 && (el.textContent ?? '').trim().length > 0;
    };
    const out: string[] = [];
    const sel = '[disabled], [aria-disabled="true"]';
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (s.display === 'none' || s.visibility === 'hidden' || (r.width === 0 && r.height === 0)) continue;
      const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      const described = ids.some((id) => visible(document.getElementById(id)));
      // A disabled option inside a described group (the group carries the reason).
      const group = el.closest('[role="radiogroup"], [role="group"], fieldset');
      const groupIds = (group?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      const groupDescribed = groupIds.some((id) => visible(document.getElementById(id)));
      if (!described && !groupDescribed) {
        const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '';
        out.push(`${el.tagName.toLowerCase()}[role=${el.getAttribute('role') ?? ''}] "${name}" ${el.outerHTML.slice(0, 160)}`);
      }
    }
    return out;
  });
}

/** Elements whose computed scroll-behavior is smooth. */
export async function smoothScrollers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of [document.documentElement, ...Array.from(document.querySelectorAll<HTMLElement>('body, body *'))]) {
      if (getComputedStyle(el).scrollBehavior === 'smooth') out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] ?? ''}`);
    }
    return out.slice(0, 6);
  });
}

/** Running animations that pulse (repeat for ever) or scale, and transitions on transform, scale or inset: the reduced-motion offenders. */
export async function pulsingOrScaling(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .filter((a) => {
        const eff = a.effect as KeyframeEffect | null;
        const timing = eff?.getComputedTiming?.();
        const frames = eff?.getKeyframes?.() ?? [];
        const props = new Set(frames.flatMap((f) => Object.keys(f)));
        const name = (a as CSSTransition).transitionProperty ?? '';
        const infinite = timing?.iterations === Infinity;
        const dur = Number(timing?.duration ?? 0);
        const scales = ['transform', 'scale', 'translate', 'rotate'].some((p) => props.has(p) || name === p);
        return (infinite && dur > 0) || (scales && dur > 0);
      })
      .map((a) => `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'animation'} on ${(a.effect as KeyframeEffect | null)?.target?.tagName ?? '?'}.${String((a.effect as KeyframeEffect | null)?.target?.className ?? '').split(' ')[0]}`),
  );
}

/** Horizontal overflow of the document (a phone must never scroll sideways). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Records every scroll call that asks for behavior "smooth" (scrollIntoView, scrollTo, scrollBy, scroll) in window.__smoothCalls. */
export async function watchSmoothScroll(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __smoothCalls: string[] };
    w.__smoothCalls = [];
    const wrap = (proto: object, name: string): void => {
      const orig = (proto as Record<string, (...a: unknown[]) => unknown>)[name];
      if (typeof orig !== 'function') return;
      (proto as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
        const opt = args[0];
        if (opt && typeof opt === 'object' && (opt as { behavior?: string }).behavior === 'smooth') w.__smoothCalls.push(`${name} ${String((this as Element | undefined)?.className ?? '')}`);
        return orig.apply(this, args);
      };
    };
    for (const n of ['scrollIntoView', 'scrollTo', 'scrollBy', 'scroll']) wrap(Element.prototype, n);
    for (const n of ['scrollTo', 'scrollBy', 'scroll']) wrap(Window.prototype, n);
  });
}

export async function smoothScrollCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __smoothCalls?: string[] }).__smoothCalls ?? []);
}
