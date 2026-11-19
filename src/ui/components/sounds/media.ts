import { useEffect, useState } from 'react';

/** Below this width the sounds live in a dock and the confirm is a sheet (05 section 8.8). */
export const DOCK_QUERY = '(max-width: 1023.98px)';
/** Phones: the listen confirm becomes a sheet (05 section 9.4). */
export const PHONE_QUERY = '(max-width: 639.98px)';

function read(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Tracks a media query. false where matchMedia is missing. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => read(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}
