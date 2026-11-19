/**
 * STARS highlights drawn inside the system SVGs (04 section 5.3): outlines in the brass tint around chosen notes.
 * They sit in the frame's own SVGs, so page layout and scaling carry them; the scan screen removes them when a row
 * loses focus and before the count-in.
 */
import type { ScoreLayout } from '../../../core/types.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const HIGHLIGHT_CLASS = 'scan-highlight';
const PAD_PX = 3;

export function clearHighlights(host: ParentNode): void {
  for (const el of Array.from(host.querySelectorAll(`.${HIGHLIGHT_CLASS}`))) el.remove();
}

/** Draws one outline per event id that has a box in a rendered system. Returns how many were drawn. */
export function drawHighlights(host: ParentNode, layout: ScoreLayout, eventIds: readonly string[]): number {
  clearHighlights(host);
  let drawn = 0;
  for (const id of eventIds) {
    const box = layout.noteBoxes.get(id);
    if (!box) continue;
    const svg = host.querySelector(`svg[data-system="${box.system}"]`);
    if (!svg) continue;
    const rect = svg.ownerDocument.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', HIGHLIGHT_CLASS);
    rect.setAttribute('x', String(box.x - PAD_PX));
    rect.setAttribute('y', String(box.y - PAD_PX));
    rect.setAttribute('width', String(box.w + 2 * PAD_PX));
    rect.setAttribute('height', String(box.h + 2 * PAD_PX));
    rect.setAttribute('rx', String(PAD_PX));
    rect.setAttribute('aria-hidden', 'true');
    svg.appendChild(rect);
    drawn++;
  }
  return drawn;
}
