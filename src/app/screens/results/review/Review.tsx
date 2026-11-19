/**
 * Review interactions on the results screen (04 §5.5.1, §6.5, §6.6, §8.3; work package D8b): the annotated score in
 * review rendering with heat strip, replay brackets and ghost tails; the "My take / Clean score" switch (C); the slip
 * stepper (Shift+← / Shift+→) with the counts-line filters; the note inspector (click or Enter); a roving tabindex over
 * the notes (← / →, ↑ / ↓ by system).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { AttemptRecord, Configs, ExpectedNote, PreparedExcerpt, ResolvedTolerance, ScoreLayout } from '../../../../core/types.ts';
import { SegmentedControl } from '../../../../ui/components/form/index.ts';
import type { Insets } from '../../../../ui/layout-table.ts';
import { Glyph, openOverlayCount, Popover } from '../../../../ui/primitives/index.ts';
import { ScoreFrame, type Box, type FrameLayoutInfo, type FrameNotation, type ScoreFrameController } from '../../../../ui/score-frame/index.ts';
import type { ReviewBus } from './bus.ts';
import { clearExtras, decorateNotes, drawExtras, drawSelection, ghostGroup, noteGroup, setTabStop, systemSvgs } from './dom.ts';
import { buildReview, inspectorFor, sameTarget, slipsFor, stepSlip, type GhostSpeller, type ReviewModel, type SlipFilter, type SlipTarget } from './model.ts';
import { rtext, type ReviewTextKey } from './text.ts';
import './review.css';

export type ShowMode = 'take' | 'clean';

export interface ReviewProps {
  record: AttemptRecord;
  prepared: PreparedExcerpt;
  /** The take's expected notes (session `planTake(prepared, cfg).expected`). */
  expected: readonly ExpectedNote[];
  tolerances?: readonly ResolvedTolerance[] | null;
  configs: Configs;
  loadNotation: () => Promise<FrameNotation>;
  /** follow's `ghostPitch`, passed by the composition root (app/ may not import follow/ or theory/). */
  spell: GhostSpeller;
  /** "Show cents and milliseconds in review" (default on). */
  showNumbers?: boolean;
  /** Single-key shortcuts (C) are on (WCAG 2.1.4; default on). */
  keyboardShortcuts?: boolean;
  /** Shared with the results panel's counts line; a local filter is used without one. */
  bus?: ReviewBus;
  reducedMotion?: () => boolean;
  highContrast?: () => boolean;
  /** Layout inputs for tests; default the window and the resolved safe-area insets. */
  viewport?: Box;
  insets?: Insets;
  /**
   * Not graded (void): the clean score in ink with no marks, the line "Clean score. Nothing is marked when a take is
   * not graded.", and no My take / Clean score switch or slip stepper (05 section 8.11, 06 section 6.15).
   */
  clean?: boolean;
  /** Bar wash by 0-based measure index: the bar Listen is playing, or the tapped bar Listen will start from. */
  highlightBar?: number | null;
  /** A tap on a bar away from a note or mark (0-based measure index), e.g. to start Listen there. */
  onBarTap?: (barIndex: number) => void;
  /** The right end of the score toolbar: the live caption, Slower and Listen (results owns them). */
  toolbarEnd?: ReactNode;
}

const FILTER_TEXT: Record<Exclude<SlipFilter, 'all'>, ReviewTextKey> = {
  rejudged: 'review.filter.rejudged',
  correct: 'review.filter.correct',
  timing: 'review.filter.timing',
  pitch: 'review.filter.pitch',
  wrong: 'review.filter.wrong',
  missed: 'review.filter.missed',
  extra: 'review.filter.extra',
};

function useFilter(bus: ReviewBus | undefined): [SlipFilter, (f: SlipFilter) => void] {
  const [local, setLocal] = useState<SlipFilter>('all');
  const sub = useCallback((l: () => void) => (bus ? bus.subscribe(l) : () => {}), [bus]);
  const get = useCallback(() => (bus ? bus.get() : local), [bus, local]);
  const value = useSyncExternalStore(sub, get, get);
  const set = useCallback((f: SlipFilter) => (bus ? bus.set(f) : setLocal(f)), [bus]);
  return [value, set];
}

const isEditable = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  return /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable;
};

export function Review(props: ReviewProps) {
  const { record, prepared, expected, tolerances, configs, loadNotation, spell, showNumbers = true, keyboardShortcuts = true, bus } = props;
  const forcedClean = props.clean === true;
  const instrument = configs.instrumentById[record.instrumentId];
  const uid = `rv${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<ScoreFrameController | null>(null);
  const layoutRef = useRef<ScoreLayout | null>(null);
  const notesRef = useRef<Map<number, SVGGElement>>(new Map());
  const [ready, setReady] = useState(0);
  const [show, setShow] = useState<ShowMode>('take');
  const [selected, setSelected] = useState<SlipTarget | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [filter, setFilter] = useFilter(bus);

  const model: ReviewModel | null = useMemo(() => {
    if (!instrument) return null;
    return buildReview({
      record,
      prepared,
      expected,
      instrument,
      spell,
      tolerances: tolerances ?? null,
      patternName: (id) => configs.tips.patterns.find((p) => p.id === id)?.name,
      showNumbers,
    });
  }, [record, prepared, expected, instrument, spell, tolerances, configs, showNumbers]);

  const slips = useMemo(() => (model ? slipsFor(model, filter) : []), [model, filter]);
  const eventIdOf = useCallback((idx: number) => expected[idx]?.eventIds[0], [expected]);
  const latest = useRef({ model, show, selected });
  latest.current = { model, show, selected };

  /** Paint the review onto the frame: final states and ghosts (My take) or plain ink (Clean score), then the extras. */
  const paint = useCallback(
    (frame: ScoreFrameController, layout: ScoreLayout) => {
      const host = wrapRef.current?.querySelector<HTMLElement>('.sf-host');
      const { model: m, show: s, selected: sel } = latest.current;
      if (!host || !m) return;
      frame.clearOverlay();
      frame.setMode('review');
      if (s === 'take' && !frame.isClean) {
        for (const n of m.notes) frame.setNoteState(n.idx, n.state);
        for (const g of m.ghosts) frame.showGhost(g);
        drawExtras({ host, layout, model: m, clef: prepared.clef, uid });
      } else clearExtras(host);
      notesRef.current = decorateNotes(host, m, sel?.kind === 'note' ? sel.idx : null);
      drawSelection(host, layout, m, eventIdOf, sel, prepared.clef);
    },
    [prepared.clef, uid, eventIdOf],
  );

  const onLayout = useCallback(
    (info: FrameLayoutInfo, frame: ScoreFrameController) => {
      frameRef.current = frame;
      layoutRef.current = info.layout;
      paint(frame, info.layout);
      setReady((n) => n + 1);
    },
    [paint],
  );

  // Re-paint when the mode or the model changes (a settings change rebuilds the inspector text).
  useEffect(() => {
    const f = frameRef.current;
    const l = layoutRef.current;
    if (f && l) paint(f, l);
  }, [show, model, paint, forcedClean]);

  // The selection ring and the roving tab stop follow the selection.
  useEffect(() => {
    const host = wrapRef.current?.querySelector<HTMLElement>('.sf-host');
    const l = layoutRef.current;
    if (!host || !l || !model) return;
    drawSelection(host, l, model, eventIdOf, selected, prepared.clef);
    if (selected?.kind === 'note') setTabStop(notesRef.current, selected.idx);
  }, [selected, model, eventIdOf, prepared.clef, ready]);

  const hostEl = (): HTMLElement | null => wrapRef.current?.querySelector<HTMLElement>('.sf-host') ?? null;

  const reduced = (): boolean => props.reducedMotion?.() ?? document.documentElement.getAttribute('data-motion') === 'reduced';

  /** Move to a target: select it, focus its note, scroll its system into view (phones review as a scroll, 04 §4.3). */
  const goTo = (t: SlipTarget | null, open: boolean): void => {
    setSelected(t);
    setInspecting(open && t !== null);
    const host = hostEl();
    if (!t || !host) return;
    const g = t.kind === 'note' ? noteGroup(host, t.idx) : ghostGroup(host, t.detectedId);
    if (t.kind === 'note' && g) {
      setTabStop(notesRef.current, t.idx);
      (g as unknown as HTMLElement).focus?.({ preventScroll: true });
    }
    const sys = g?.closest('svg.sr-system');
    (sys as (Element & { scrollIntoView?: (o: ScrollIntoViewOptions) => void }) | null | undefined)?.scrollIntoView?.({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  };

  const step = (dir: 1 | -1): void => {
    const next = stepSlip(slips, selected, dir);
    if (next) goTo(next, true);
  };

  // A new filter from the counts line starts the stepper at its first slip.
  const lastFilter = useRef(filter);
  useEffect(() => {
    if (lastFilter.current === filter) return;
    lastFilter.current = filter;
    if (slips.length > 0) goTo(slips[0]!, true);
    else setInspecting(false);
    // goTo reads refs only; slips follows filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, slips]);

  // C: My take / Clean score (04 §8.3).
  useEffect(() => {
    if (!keyboardShortcuts || forcedClean) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || isEditable(e.target)) return;
      if (openOverlayCount() > (inspecting ? 1 : 0)) return;
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setShow((s) => (s === 'take' ? 'clean' : 'take'));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [keyboardShortcuts, inspecting, forcedClean]);

  if (!model) return null;

  const order = model.notes.map((n) => n.idx);
  const targetOf = (el: Element | null): SlipTarget | null => {
    const note = el?.closest('[data-rv-idx]');
    if (note) {
      const idx = Number(note.getAttribute('data-rv-idx'));
      const n = model.notes.find((x) => x.idx === idx);
      return n ? { kind: 'note', idx, beat: n.beat } : null;
    }
    const ghost = el?.closest('.sr-ghost[data-detected-id]');
    if (ghost) {
      const id = Number(ghost.getAttribute('data-detected-id'));
      const x = model.extras.find((e) => e.detectedId === id);
      if (x) return { kind: 'extra', detectedId: id, beat: x.beat };
      const n = model.notes.find((e) => e.ghost?.detectedId === id);
      if (n) return { kind: 'note', idx: n.idx, beat: n.beat };
    }
    return null;
  };

  const onClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const t = targetOf(e.target as Element);
    if (!t) return;
    if (inspecting && sameTarget(t, selected)) {
      setInspecting(false);
      return;
    }
    goTo(t, true);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const t = targetOf(e.target as Element);
    if (!t || t.kind !== 'note') return;
    const i = order.indexOf(t.idx);
    const host = hostEl();
    const noteAt = (k: number): SlipTarget | null => {
      const n = model.notes[k];
      return n ? { kind: 'note', idx: n.idx, beat: n.beat } : null;
    };
    let handled = true;
    if (e.key === 'Enter' || e.key === ' ') {
      if (inspecting && sameTarget(t, selected)) setInspecting(false);
      else goTo(t, true);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.shiftKey) {
      const next = stepSlip(slips, selected && sameTarget(selected, t) ? selected : t, e.key === 'ArrowRight' ? 1 : -1);
      if (next) goTo(next, true);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const k = Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      goTo(noteAt(k), inspecting);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && host) {
      const sysOf = (idx: number): number => Number(noteGroup(host, idx)?.getAttribute('data-system') ?? 0);
      const here = sysOf(t.idx);
      const systems = [...systemSvgs(host).keys()].sort((a, b) => a - b);
      const want = systems[systems.indexOf(here) + (e.key === 'ArrowDown' ? 1 : -1)];
      const k = want === undefined ? -1 : model.notes.findIndex((n) => sysOf(n.idx) === want);
      if (k >= 0) goTo(noteAt(k), inspecting);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const host = hostEl();
  const anchor = selected && host ? (selected.kind === 'note' ? noteGroup(host, selected.idx) : ghostGroup(host, selected.detectedId)) : null;
  const lines = selected ? inspectorFor(model, selected) : [];
  const at = selected ? slips.findIndex((s) => sameTarget(s, selected)) : -1;

  const clean = forcedClean || show === 'clean';
  return (
    <div className="rv-review" data-testid="review" data-show={clean ? 'clean' : 'take'} data-filter={filter} data-void={forcedClean ? 'true' : undefined}>
      {forcedClean ? (
        <p className="rv-void-line" data-testid="review-void-line">
          {rtext('results.void.cleanScore')}
        </p>
      ) : null}
      <div className="rv-toolbar">
        {forcedClean ? null : (
          <>
            <SegmentedControl<ShowMode>
              ariaLabel={rtext('review.toolbar')}
              value={show}
              onChange={setShow}
              options={[
                { value: 'take', label: rtext('results.myTake') },
                { value: 'clean', label: rtext('results.cleanScore') },
              ]}
            />
            <div className="rv-stepper">
              <button
                type="button"
                className="ui-button ui-button-secondary ui-button-compact rv-step"
                data-testid="prev-slip"
                onClick={() => step(-1)}
                aria-disabled={slips.length === 0 ? 'true' : undefined}
              >
                <Glyph id="chevron-left" size={16} />
                <span>{rtext('action.previousSlip')}</span>
              </button>
              <button
                type="button"
                className="ui-button ui-button-secondary ui-button-compact rv-step"
                data-testid="next-slip"
                onClick={() => step(1)}
                aria-disabled={slips.length === 0 ? 'true' : undefined}
              >
                <span>{rtext('action.nextSlip')}</span>
                <Glyph id="chevron-right" size={16} />
              </button>
              <span className="rv-slip-count" aria-live="polite">
                {slips.length === 0 ? rtext('review.noSlips') : at >= 0 ? rtext('review.slipCount', { n: at + 1, total: slips.length }) : null}
              </span>
            </div>
          </>
        )}
        {filter !== 'all' && !forcedClean ? (
          <div className="rv-filter" data-testid="review-filter">
            <span>{rtext(FILTER_TEXT[filter])}</span>
            <button type="button" className="ui-button ui-button-quiet ui-button-compact rv-all-slips" onClick={() => setFilter('all')}>
              {rtext('results.allSlips')}
            </button>
          </div>
        ) : null}
        {props.toolbarEnd ? <div className="rv-toolbar-end">{props.toolbarEnd}</div> : null}
      </div>
      {/* Clicks and keys on the notes bubble here (the notes are SVG groups drawn by notation). */}
      <div ref={wrapRef} className="rv-score" onClick={onClick} onKeyDown={onKeyDown}>
        <ScoreFrame
          loadNotation={loadNotation}
          excerpt={prepared}
          bpm={record.bpm}
          arrangement="all"
          purpose="review"
          clean={clean}
          highlightBar={props.highlightBar ?? null}
          {...(props.onBarTap ? { onBarTap: props.onBarTap } : {})}
          label={rtext('review.label')}
          {...(props.viewport ? { viewport: props.viewport } : {})}
          {...(props.insets ? { insets: props.insets } : {})}
          {...(props.reducedMotion ? { reducedMotion: props.reducedMotion } : {})}
          {...(props.highContrast ? { highContrast: props.highContrast } : {})}
          ref={frameRef}
          onLayout={onLayout}
        />
      </div>
      <Popover open={inspecting && lines.length > 0 && anchor !== null} anchor={anchor as unknown as HTMLElement | null} label={rtext('review.inspector.label')} onClose={() => goTo(selected, false)}>
        <div className="rv-inspector" data-testid="note-inspector">
          {lines.map((l, i) => (
            <p key={i} className={i === 0 ? 'rv-inspector-head' : 'rv-inspector-line'}>
              {l}
            </p>
          ))}
        </div>
      </Popover>
    </div>
  );
}
