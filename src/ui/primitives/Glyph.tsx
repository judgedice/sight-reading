import type { SVGAttributes } from 'react';
import spriteSource from '../glyphs.svg?raw';
import type { GlyphId } from '../glyph-ids.ts';

/** The sprite, inlined once near the root so `<use href="#id">` resolves (04 section 7.4). */
export function GlyphSprite() {
  return <div hidden aria-hidden="true" dangerouslySetInnerHTML={{ __html: spriteSource }} />;
}

export interface GlyphProps extends Omit<SVGAttributes<SVGSVGElement>, 'children'> {
  id: GlyphId;
  /** Rendered size in CSS px; the icon default is 20 (7.4). */
  size?: number;
}

/**
 * Stroke width of the icon family (06 section 8): 1.75 at 16 to 24 px, 1.5 at 28 px and up.
 * It is set on the outer svg and inherited into the sprite symbols, which leave it unset.
 */
export function iconStrokeWidth(size: number): number {
  return size >= 28 ? 1.5 : 1.75;
}

/** A decorative glyph coloured by currentColor. Pair it with a text label or aria-label on its parent. */
export function Glyph({ id, size = 20, ...rest }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" strokeWidth={iconStrokeWidth(size)} {...rest}>
      <use href={`#${id}`} />
    </svg>
  );
}
