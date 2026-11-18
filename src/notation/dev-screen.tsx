// `#/dev/notation`: loads the notation module as its own lazy chunk (main.tsx imports this file dynamically), so
// the bundle size can be measured (tools/size-check.ts) and the chunk split stays honest until a real screen imports
// notation. Dev only: main.tsx loads it when import.meta.env.DEV or VITE_NOTATION_DEV is set.

import { useEffect, useRef, useState } from 'react';
import { VexScoreView, ensureNotationFonts } from './index.ts';

export default function DevNotationScreen() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Constructing the view keeps the whole notation module reachable from this chunk.
    const view = new VexScoreView();
    host.current?.setAttribute('data-view', typeof view.render);
    void ensureNotationFonts().then(() => setReady(true));
  }, []);
  return (
    <section data-testid="screen-dev-notation" data-ready={ready}>
      <div ref={host} />
    </section>
  );
}
