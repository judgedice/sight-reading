// <ScoreFrame>: the paper surface that owns the system SVGs and the ScoreView (04 §7.5). Loads notation lazily
// through `loadNotation` (ui/ cannot import notation/, 01 §4.2; PLAN ruling 39 keeps it a lazy chunk), lays the
// excerpt out at reveal, re-lays out on resize until it is frozen, then only scales (04 §4.4).
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import type { PreparedExcerpt } from '../../core/types.ts';
import type { Insets } from '../layout-table.ts';
import {
  ScoreFrameController,
  contentBox,
  readInsets,
  type Arrangement,
  type Box,
  type FrameLayoutArgs,
  type FrameLayoutInfo,
  type FramePurpose,
  type FrozenResize,
} from './controller.ts';
import { documentAppearance, type FrameNotation, type FrameViewOptions } from './notation-binding.ts';
import './score-frame.css';

export interface ScoreFrameProps {
  /** e.g. `() => import('../notation/index.ts').then(bindNotation)`; called once per loader. */
  loadNotation: () => Promise<FrameNotation>;
  excerpt: PreparedExcerpt | null;
  /** Take tempo (metronome bpm) for page-turn timing. */
  bpm: number;
  /** 'slots' for the take; 'all' for the natural-order scroll (scan and review on phones). Default 'slots'. */
  arrangement?: Arrangement;
  /** True from count-in start to the end of the take. */
  frozen?: boolean;
  /** Window viewport for row selection; default window.innerWidth × innerHeight. */
  viewport?: Box;
  /** Safe-area insets; default the resolved --sai-top / --sai-bottom. */
  insets?: Insets;
  reducedMotion?: () => boolean;
  highContrast?: () => boolean;
  /** Accessible name of the frame (a copy() string). */
  label?: string;
  className?: string;
  ref?: Ref<ScoreFrameController | null>;
  /** After each layout (reveal, or a re-layout outside a take). */
  onLayout?: (info: FrameLayoutInfo, frame: ScoreFrameController) => void;
  onSlotsChange?: (slotSystems: number[], systemCount: number) => void;
  /** A resize while frozen; the frame has already scaled. `orientationChanged` lets the screen cancel a count-in. */
  onFrozenResize?: (r: FrozenResize) => void;
  onError?: (e: unknown) => void;
  /** Staff space and page margins from the score tokens (06 section 7). Omitted: the 04 layout table. */
  purpose?: FramePurpose;
  /** Content of the count-in band (e.g. <CountInBand>), shown in the top margin above the first system; later systems drop to 50%. */
  band?: ReactNode;
  /** Bar wash by 0-based measure index (Listen, a tapped bar); null or omitted for none. */
  highlightBar?: number | null;
  /** Wash behind the key signature (the key chord is sounding). */
  highlightKey?: boolean;
  /** The first note highlighted, with this name above it (the first note is sounding). Remove before the count-in. */
  firstNoteName?: string | null;
  /** Clean score: no marks (void results, review's "Clean score"). */
  clean?: boolean;
  /** A tap or click on a bar that is not on a note's mark (review): the 0-based measure index. */
  onBarTap?: (barIndex: number) => void;
}

const loads = new WeakMap<() => Promise<FrameNotation>, Promise<FrameNotation>>();
function loadOnce(f: () => Promise<FrameNotation>): Promise<FrameNotation> {
  let p = loads.get(f);
  if (!p) {
    p = f();
    loads.set(f, p);
  }
  return p;
}

function windowViewport(el: HTMLElement): Box {
  const w = el.ownerDocument.defaultView;
  return { width: w?.innerWidth ?? 0, height: w?.innerHeight ?? 0 };
}

const sameArgs = (a: FrameLayoutArgs, b: FrameLayoutArgs): boolean =>
  a.bpm === b.bpm &&
  a.purpose === b.purpose &&
  (a.purpose === undefined || a.heightPx === b.heightPx) &&
  a.widthPx === b.widthPx &&
  a.viewport.width === b.viewport.width &&
  a.viewport.height === b.viewport.height &&
  a.insets.top === b.insets.top &&
  a.insets.bottom === b.insets.bottom;

export function ScoreFrame(props: ScoreFrameProps) {
  const { loadNotation, excerpt, bpm, arrangement = 'slots', frozen = false, viewport, insets, label, className, ref, purpose } = props;
  const { band, highlightBar = null, highlightKey = false, firstNoteName = null, clean = false } = props;
  const [bandSlot, setBandSlot] = useState<HTMLElement | null>(null);
  const [laidOut, setLaidOut] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<ScoreFrameController | null>(null);
  const [notation, setNotation] = useState<FrameNotation | null>(null);
  // Latest props for callbacks and observers, without re-running effects.
  const live = useRef(props);
  const lastArgs = useRef<FrameLayoutArgs | null>(null);
  useEffect(() => {
    live.current = props;
  });

  useImperativeHandle<ScoreFrameController | null, ScoreFrameController | null>(ref, () => frame, [frame]);

  // Load notation and create the controller once per host.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let ctl: ScoreFrameController | null = null;
    const defaults = documentAppearance(host.ownerDocument);
    loadOnce(loadNotation).then(
      (n) => {
        if (cancelled) return;
        const appearance: Partial<FrameViewOptions> = {
          reducedMotion: () => live.current.reducedMotion?.() ?? defaults.reducedMotion(),
          highContrast: () => live.current.highContrast?.() ?? defaults.highContrast(),
        };
        ctl = new ScoreFrameController(host, n, {
          appearance,
          onSlotsChange: (s, total) => live.current.onSlotsChange?.(s, total),
        });
        setNotation(n);
        setFrame(ctl);
      },
      (e: unknown) => {
        if (!cancelled) live.current.onError?.(e);
      },
    );
    return () => {
      cancelled = true;
      ctl?.destroy();
      setFrame(null);
    };
  }, [loadNotation]);

  // Lay out at reveal (new excerpt or tempo). Never while frozen.
  useEffect(() => {
    const host = hostRef.current;
    if (!frame || !notation || !host || !excerpt) return;
    // A new excerpt in the same commit as frozen=true is not laid out: VexFlow never renders during a take.
    if (frame.frozen || live.current.frozen) return;
    let cancelled = false;
    host.removeAttribute('data-ready');
    try {
      const vp = viewport ?? windowViewport(host);
      frame.setMargins(purpose ?? null, vp.width);
      const box = contentBox(host);
      const args: FrameLayoutArgs = {
        viewport: vp,
        insets: insets ?? readInsets(host),
        widthPx: box.width,
        bpm,
        ...(purpose ? { purpose, heightPx: box.height } : {}),
      };
      const info = frame.layout(excerpt, args, notation.tickablesPerBar(excerpt));
      lastArgs.current = args;
      setLaidOut((n) => n + 1);
      live.current.onLayout?.(info, frame);
    } catch (e) {
      live.current.onError?.(e);
      return;
    }
    void notation.ensureNotationFonts().then(() => {
      if (!cancelled) host.setAttribute('data-ready', 'true');
    });
    return () => {
      cancelled = true;
    };
    // viewport and insets are compared by value in the resize path; a new object alone must not re-render VexFlow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, notation, excerpt, bpm, purpose]);

  useEffect(() => {
    frame?.setArrangement(arrangement);
  }, [frame, arrangement]);

  useEffect(() => {
    if (!frame) return;
    if (frozen) frame.freeze();
    else frame.unfreeze();
  }, [frame, frozen]);

  // Resizes: scale while frozen; otherwise re-lay out when the inputs really changed.
  const relayout = useRef<() => void>(() => {});
  relayout.current = () => {
    const host = hostRef.current;
    const prev = lastArgs.current;
    if (!frame || !host || !prev || !frame.info) return;
    if (frame.frozen) {
      const r = frame.resize(contentBox(host));
      if (r) live.current.onFrozenResize?.(r);
      return;
    }
    const p = live.current;
    const vp = p.viewport ?? windowViewport(host);
    frame.setMargins(p.purpose ?? null, vp.width);
    const box = contentBox(host);
    const args: FrameLayoutArgs = {
      viewport: vp,
      insets: p.insets ?? readInsets(host),
      widthPx: box.width,
      bpm: p.bpm,
      ...(p.purpose ? { purpose: p.purpose, heightPx: box.height } : {}),
    };
    if (sameArgs(args, prev)) return;
    try {
      const info = frame.relayout(args);
      lastArgs.current = args;
      setLaidOut((n) => n + 1);
      if (info) p.onLayout?.(info, frame);
    } catch (e) {
      p.onError?.(e);
    }
  };

  useEffect(() => {
    relayout.current();
  }, [viewport?.width, viewport?.height, insets?.top, insets?.bottom]);

  useEffect(() => {
    const host = hostRef.current;
    const win = host?.ownerDocument.defaultView;
    if (!host || !win) return;
    const onResize = (): void => relayout.current();
    let ro: ResizeObserver | null = null;
    if (typeof win.ResizeObserver === 'function') {
      ro = new win.ResizeObserver(onResize);
      ro.observe(host);
    }
    win.addEventListener('resize', onResize);
    return () => {
      ro?.disconnect();
      win.removeEventListener('resize', onResize);
    };
  }, []);

  // Highlights, clean score and the band follow their props; each layout redraws them in the controller.
  useEffect(() => {
    frame?.setClean(clean);
  }, [frame, clean]);
  useEffect(() => {
    frame?.highlightBar(highlightBar);
  }, [frame, highlightBar, laidOut]);
  useEffect(() => {
    frame?.highlightKeySignature(highlightKey);
  }, [frame, highlightKey, laidOut]);
  useEffect(() => {
    frame?.highlightFirstNote(firstNoteName);
  }, [frame, firstNoteName, laidOut]);
  const hasBand = band !== undefined && band !== null && band !== false;
  useEffect(() => {
    if (!frame) return;
    setBandSlot(frame.showBand(hasBand));
  }, [frame, hasBand, laidOut]);

  useEffect(() => {
    if (bandSlot && hasBand) frame?.refreshBand();
  });

  // Bar taps (review): a click that no note or mark handled, mapped to the bar under it.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !frame) return;
    const onClick = (e: MouseEvent): void => {
      const tap = live.current.onBarTap;
      if (!tap || e.defaultPrevented) return;
      const t = e.target as Element | null;
      if (t?.closest('[data-rv-idx], .sr-ghost')) return;
      const bar = frame.barAtClient(t, e.clientX);
      if (bar !== null) tap(bar);
    };
    host.addEventListener('click', onClick);
    return () => host.removeEventListener('click', onClick);
  }, [frame]);

  return (
    <>
      <div ref={hostRef} className={className ? `sf-host ${className}` : 'sf-host'} role={label ? 'figure' : undefined} aria-label={label} />
      {bandSlot && hasBand ? createPortal(band, bandSlot) : null}
    </>
  );
}
