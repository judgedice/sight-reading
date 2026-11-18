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

/** A decorative glyph coloured by currentColor. Pair it with a text label or aria-label on its parent. */
export function Glyph({ id, size = 20, ...rest }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...rest}>
      <use href={`#${id}`} />
    </svg>
  );
}
