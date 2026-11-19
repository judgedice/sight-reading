// The 300 ms font cap (06 section 2.1). The @font-face rules in tokens.css use font-display: block, which browsers
// honour for several seconds. This module shortens that: when the three faces are not ready 300 ms after start, the root
// gets data-fonts="fallback", tokens.css then drops the web fonts from --font-display and --font-ui, and text shows in
// the system stack. When the faces arrive the attribute is removed and the web fonts take over. If a face fails to
// load, the fallback stays for the page's life. The fonts are same-origin files, preloaded by index.html and
// precached by the service worker, so on a repeat visit they are ready before the cap.

export const FONT_CAP_MS = 300;

/** The faces to wait for: a display weight, a text weight, and the music-text glyphs (U+2669, U+266A, U+266D to U+266F). */
export const FONT_PROBES: readonly { font: string; text?: string }[] = [
  { font: '600 34px "Source Serif 4"' },
  { font: '400 16px "Inter"' },
  { font: '400 16px "Sightread Music Text"', text: '♩♪♭♮♯' },
];

/** The part of FontFaceSet this module uses. */
export interface FontSetLike {
  load(font: string, text?: string): Promise<unknown>;
}

/**
 * Starts loading the faces and applies the cap. Resolves when the faces are loaded or have failed; never rejects.
 * A missing FontFaceSet (Node, old browsers) leaves the root alone.
 */
export async function applyFontCap(
  root: Element,
  fonts: FontSetLike | undefined,
  capMs: number = FONT_CAP_MS,
): Promise<'ready' | 'fallback'> {
  if (!fonts) return 'ready';
  let done = false;
  const timer = setTimeout(() => {
    if (!done) root.setAttribute('data-fonts', 'fallback');
  }, capMs);
  try {
    await Promise.all(FONT_PROBES.map((p) => fonts.load(p.font, p.text)));
    done = true;
    clearTimeout(timer);
    root.removeAttribute('data-fonts');
    return 'ready';
  } catch {
    done = true;
    clearTimeout(timer);
    root.setAttribute('data-fonts', 'fallback');
    return 'fallback';
  }
}
