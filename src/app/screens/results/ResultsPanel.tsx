/**
 * The results page (05 section 8.11, 06 section 6.15, designer's notes 8 to 10 and 17): header with the grade, the
 * badge, XP and rank line, the reason and (desktop) the actions; the score card; "One thing to try"; "How it went";
 * the difficulty offer and (phones) the actions at the page end, with a bar pinned to the bottom once the header has
 * scrolled away.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AttemptRecord, Configs, PlayerProfile, ProgressEvent, Tip } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { GradeBadge, StarRow } from '../../../ui/components/domain/index.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { ClippingBanner, RecheckShiftBanner, RejudgedBanner, voidCopy } from '../states/index.ts';
import {
  clippingBanner,
  componentRows,
  countParts,
  diagnosticLines,
  focusComponent,
  headerState,
  levelCards,
  manyRejudged,
  personalBest,
  rankLine,
  rejudgedCount,
  xpView,
  type CountKind,
  type HearSpan,
  type HeaderState,
  type LevelCard,
} from './model.ts';
import { TipsSection } from './TipsSection.tsx';
import { text } from './text.ts';
import './results.css';

/** Everything the page can ask for. All optional: a missing handler hides its control. */
export interface ResultsHandlers {
  onNext?: () => void;
  onTryAgain?: () => void;
  /** "Change setup": the setup sheet over results. */
  onChangeSetup?: () => void;
  onMoveUp?: (instrumentId: string, to: number) => void;
  onStayAt?: (instrumentId: string, level: number) => void;
  onUndoLevelUp?: (instrumentId: string, from: number) => void;
  onGoToLevel?: (instrumentId: string, level: number) => void;
  onRecalibrate?: () => void;
  onCheckMicrophone?: () => void;
  /** "Calibrate now" beside the not-calibrated reason. Defaults to `onRecalibrate`. */
  onCalibrateNow?: () => void;
  /** A count in the counts line was pressed: the slip stepper restricts to that verdict (D8b). */
  onSelectVerdict?: (kind: CountKind) => void;
  /** The "re-judged after the take" button was pressed (D8b). */
  onShowRejudged?: () => void;
  /** "Hear bar n" in "One thing to try". */
  onHearBars?: (span: HearSpan) => void;
  /** The "Show a tip after each take" switch in "One thing to try". */
  onShowTipsChange?: (on: boolean) => void;
}

export interface ResultsPanelProps extends ResultsHandlers {
  record: AttemptRecord;
  configs: Configs;
  profile?: PlayerProfile | undefined;
  progress?: readonly ProgressEvent[];
  tips?: readonly Tip[];
  /** The score card's content: the review with its toolbar. */
  review?: ReactNode;
  /** Desktop: actions in the header. Phones: at the page end, plus the pinned bar (default true). */
  wide?: boolean;
  /** "Show a tip after each take" (default on). Off: no "One thing to try". */
  showTips?: boolean;
  /** "Show cents and milliseconds in review": the drift in milliseconds too. */
  showNumbers?: boolean;
  /** Offer recalibration (a recheck marked the calibration stale, R31). */
  recalibrate?: boolean;
  /** The credit line (or its source-sheet button) at the page end. */
  credit?: ReactNode;
  /** Level cards already answered. */
  dismissedCards?: ReadonlySet<string>;
  onDismissCard?: (card: LevelCard) => void;
  children?: ReactNode;
}

export const cardId = (c: LevelCard): string => `${c.kind}:${c.instrumentId}`;

/** Copy that the catalogue may not hold yet: shown once the key exists, never as a literal here. */
function LevelCards({ cards, h, dismissed, dismiss }: { cards: LevelCard[]; h: ResultsHandlers; dismissed: ReadonlySet<string>; dismiss: (c: LevelCard) => void }) {
  const open = cards.filter((c) => !dismissed.has(cardId(c)));
  if (open.length === 0) return null;
  return (
    <div className="res-offers">
      {open.map((c) => (
        <section key={cardId(c)} className="res-level-card" data-testid={`level-${c.kind}`}>
          <p className="res-level-text">{c.text}</p>
          <div className="res-level-actions">
            {c.kind === 'offer' ? (
              <>
                <Button label={text('action.goToLevel', { level: c.to })} variant="primary" size="compact" onClick={() => { h.onMoveUp?.(c.instrumentId, c.to); dismiss(c); }} />
                <Button label={text('action.stayAt', { level: c.from })} size="compact" onClick={() => { h.onStayAt?.(c.instrumentId, c.from); dismiss(c); }} />
              </>
            ) : null}
            {c.kind === 'auto' ? (
              <Button label={text('action.undo')} size="compact" onClick={() => { h.onUndoLevelUp?.(c.instrumentId, c.from); dismiss(c); }} />
            ) : null}
            {c.kind === 'down' ? (
              <>
                <Button label={text('action.goToLevel', { level: c.lower })} variant="primary" size="compact" onClick={() => { h.onGoToLevel?.(c.instrumentId, c.lower); dismiss(c); }} />
                <Button label={text('action.stayAt', { level: c.level })} size="compact" onClick={() => { h.onStayAt?.(c.instrumentId, c.level); dismiss(c); }} />
              </>
            ) : null}
          </div>
        </section>
      ))}
    </div>
  );
}

function Counts({ record, h }: { record: AttemptRecord; h: ResultsHandlers }) {
  const s = record.score;
  if (!s) return null;
  const parts = countParts(s);
  const rejudged = rejudgedCount(record);
  const select = h.onSelectVerdict;
  return (
    <p className="res-counts" data-testid="res-counts">
      {parts.map((p) => (
        <span key={p.kind} className="res-count-part">
          {select && p.kind !== 'total' ? (
            <button type="button" className="res-count-button" data-count={p.kind} onClick={() => select(p.kind)}>
              {p.label}
            </button>
          ) : (
            <span data-count={p.kind}>{p.label}</span>
          )}
        </span>
      ))}
      {rejudged > 0 ? (
        <span className="res-count-part">
          <button type="button" className="res-count-button" data-count="rejudged" onClick={() => h.onShowRejudged?.()}>
            {text('results.rejudged', { n: rejudged })}
          </button>
        </span>
      ) : null}
    </p>
  );
}

/** "How it went": Notes, In tune, Rhythm as bars with numbers; the weakest hatched and named; drift in words; counts. */
function HowItWent({ record, configs, showNumbers, h }: { record: AttemptRecord; configs: Configs; showNumbers: boolean; h: ResultsHandlers }) {
  const s = record.score;
  if (!s) return null;
  const rows = componentRows(record, configs.instrumentById[record.instrumentId]);
  const focus = focusComponent(s);
  const focusRow = rows.find((r) => r.id === focus);
  const lines = diagnosticLines(s, showNumbers);
  return (
    <section className="res-card res-how" data-testid="res-components" aria-labelledby="res-how-title">
      <h2 className="res-how-title" id="res-how-title">
        {copy('results.components.title')}
      </h2>
      <div className="res-comps">
        {rows.map((r) => (
          <div key={r.id} className="res-comp" data-component={r.id} data-weakest={r.id === focus ? 'true' : undefined}>
            <span className="res-comp-label" id={`res-comp-${r.id}`}>
              {r.label}
            </span>
            {r.value === null ? (
              <span className="res-comp-none">{r.unavailableText ?? text('component.inTune.notEnough')}</span>
            ) : (
              <>
                <span className="res-comp-bar" role="meter" aria-labelledby={`res-comp-${r.id}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.value)}>
                  <span className="res-comp-fill" style={{ inlineSize: `${Math.min(100, Math.max(0, r.value))}%` }} />
                </span>
                <span className="res-comp-value">{Math.round(r.value)}</span>
              </>
            )}
          </div>
        ))}
      </div>
      {focusRow || lines.length ? (
        <p className="res-how-line" data-testid="res-diagnostics">
          {focusRow ? <strong className="res-how-focus">{text('component.focus', { component: focusRow.label })}</strong> : null}
          {lines.map((l) => (
            <span key={l} className="res-how-diag">
              {` ${l}${l.endsWith('.') ? '' : '.'}`}
            </span>
          ))}
        </p>
      ) : null}
      <Counts record={record} h={h} />
    </section>
  );
}

function NextButton({ onClick, testId }: { onClick: () => void; testId?: string }) {
  return (
    <button type="button" className="ui-button ui-button-primary ui-button-default res-next" onClick={onClick} data-autofocus="" {...(testId ? { 'data-testid': testId } : {})}>
      <span>{text('action.nextExcerpt')}</span>
      <Glyph id="arrow-right" size={16} />
    </button>
  );
}

function Actions({ state, record, h, where }: { state: HeaderState; record: AttemptRecord; h: ResultsHandlers; where: 'head' | 'end' }) {
  const cls = `res-actions res-actions-${where}`;
  if (state.kind === 'void' && record.voidReason) {
    const handlers = {
      'try-again': { label: text('action.tryAgain'), fn: h.onTryAgain },
      'check-microphone': { label: text('action.checkMicrophone'), fn: h.onCheckMicrophone },
      recalibrate: { label: text('action.recalibrate'), fn: h.onRecalibrate },
    } as const;
    const list = voidCopy(record.voidReason).actions.filter((a) => handlers[a].fn);
    if (list.length === 0) return null;
    return (
      <div className={cls} data-testid={`res-actions-${where}`}>
        {list.map((a, i) => (
          <Button key={a} label={handlers[a].label} variant={i === 0 ? 'primary' : 'secondary'} onClick={handlers[a].fn} {...(i === 0 ? { 'data-autofocus': '' } : {})} />
        ))}
      </div>
    );
  }
  if (!h.onNext && !h.onTryAgain && !h.onChangeSetup) return null;
  return (
    <div className={cls} data-testid={`res-actions-${where}`}>
      {h.onNext ? <NextButton onClick={h.onNext} /> : null}
      {h.onTryAgain ? (
        <span title={text('results.practice.tooltip')} className="res-try-again">
          <Button label={text('action.tryAgainPractice')} onClick={h.onTryAgain} />
        </span>
      ) : null}
      {h.onChangeSetup ? <Button label={text('action.changeSetup')} variant="quiet" onClick={h.onChangeSetup} /> : null}
    </div>
  );
}

/** True while the element is out of the viewport (IntersectionObserver); false where there is no observer. */
function useOutOfView(ref: { current: Element | null }, enabled: boolean): boolean {
  const [out, setOut] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver !== 'function') {
      setOut(false);
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setOut(!e.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, enabled]);
  return out;
}

export function ResultsPanel(props: ResultsPanelProps) {
  const { record, configs, profile, progress = [], tips = [], wide = true, showTips = true, showNumbers = false, recalibrate = false } = props;
  const [localDismissed, setLocalDismissed] = useState<ReadonlySet<string>>(new Set());
  const dismissed = props.dismissedCards ?? localDismissed;
  const dismiss = (c: LevelCard): void => {
    props.onDismissCard?.(c);
    setLocalDismissed((prev) => new Set(prev).add(cardId(c)));
  };
  const headRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const headGone = useOutOfView(headRef, !wide);
  const endGone = useOutOfView(endRef, !wide);
  const pinned = !wide && headGone && endGone;

  const s = record.score;
  const state = headerState(record, configs);
  const graded = s !== null && record.listening && state.kind !== 'void';
  const dataState = state.kind === 'void' ? 'void' : graded ? 'graded' : 'not-graded';
  const xp = xpView(record, configs, profile);
  const xpText = graded ? xp.headline : state.kind === 'void' ? text('xp.headline', { xp: 0 }) : null;
  const rank = profile ? rankLine(configs, profile) : null;
  const best = graded ? personalBest(progress, record.instrumentId) : null;
  const cards = levelCards(progress, record.instrumentId, configs);
  const calibrateNow = props.onCalibrateNow ?? props.onRecalibrate;
  const timingNote = record.calibration.method === 'reported' || state.kind === 'not-calibrated';
  const gradeName = s ? text('a11y.grade.heading', { grade: s.grade, score: s.score, stars: s.stars }) : '';

  const left = graded && s ? (
    <section className="res-grade" aria-label={gradeName}>
      <span className="res-grade-letter" aria-hidden="true">
        {s.grade}
      </span>
      <div className="res-grade-side" aria-hidden="true">
        <p className="res-grade-score">
          <span className="res-grade-number">{Math.round(s.score)}</span>
          <span className="res-grade-of">{copy('results.outOf')}</span>
        </p>
        <StarRow stars={s.stars} shine={s.shine} size="results" />
        <p className="res-grade-line">{text(`grade.${s.grade}`)}</p>
      </div>
    </section>
  ) : state.kind === 'void' ? (
    <h1 className="res-notgraded-title" data-testid="res-void-title">
      {text('results.badge.notGraded')}
    </h1>
  ) : (
    <h1 className="res-notgraded-title" data-testid="not-graded">
      {text('results.notGraded')}
    </h1>
  );

  const reasonLine = state.reason ? (
    <p className="res-reason" data-testid={state.kind === 'void' && record.voidReason ? `void-${record.voidReason}` : 'res-reason'}>
      <span>{state.reason}</span>
      {state.calibrateNow && calibrateNow ? <Button label={text('action.calibrateNow')} variant="quiet" size="compact" onClick={calibrateNow} /> : null}
    </p>
  ) : null;

  const offers = <LevelCards cards={cards} h={props} dismissed={dismissed} dismiss={dismiss} />;

  return (
    <div className="res-page" data-testid="results-panel" data-state={dataState} data-header={state.kind} data-layout={wide ? 'wide' : 'narrow'}>
      <header ref={headRef} className="res-head">
        <div className="res-head-left">
          {left}
          {best ? (
            <p className="res-ribbon" data-testid="res-ribbon">
              <Glyph id="check-circle" size={16} />
              <span>{best}</span>
            </p>
          ) : null}
        </div>
        <div className="res-head-right">
          {state.badge || xpText || rank ? (
            <div className="res-xp-line" data-testid="res-xp">
              {state.badge ? <GradeBadge kind={state.badge} /> : null}
              {xpText ? <span className="res-xp">{xpText}</span> : null}
              {rank ? (
                <>
                  <span className="res-rank-line" data-testid="res-rank">
                    {rank.text}
                  </span>
                  <span className="res-rank-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(rank.fraction * 100)} aria-label={rank.text}>
                    <span className="res-rank-fill" style={{ inlineSize: `${Math.round(rank.fraction * 100)}%` }} />
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
          {reasonLine}
          {wide ? (
            <>
              {offers}
              <Actions state={state} record={record} h={props} where="head" />
            </>
          ) : null}
        </div>
      </header>

      {clippingBanner(record, configs) ? <ClippingBanner /> : null}
      {manyRejudged(record) ? <RejudgedBanner /> : null}
      {(recalibrate || record.calibration.recheck?.promptRecalibrate) && props.onRecalibrate ? <RecheckShiftBanner onRecalibrate={props.onRecalibrate} /> : null}

      {props.review || state.clean ? (
        <section className="res-card res-score" data-testid="res-score" data-clean={state.clean ? 'true' : undefined} aria-label={text('results.myTake')}>
          {props.review ?? <p className="res-clean-line">{text('results.void.cleanScore')}</p>}
          {timingNote && graded ? <p className="res-timing-note">{text('badge.timingOffset')}</p> : null}
        </section>
      ) : null}

      {graded ? (
        <div className="res-cols">
          {showTips ? <TipsSection configs={configs} tips={tips} onHear={props.onHearBars} onShowTipsChange={props.onShowTipsChange} /> : null}
          <HowItWent record={record} configs={configs} showNumbers={showNumbers} h={props} />
        </div>
      ) : null}

      {wide ? null : (
        <div ref={endRef} className="res-end">
          {offers}
          <Actions state={state} record={record} h={props} where="end" />
        </div>
      )}

      {props.credit ? <div className="res-credit-line">{props.credit}</div> : null}
      {props.children}

      {pinned && state.kind !== 'void' && (props.onNext || props.onTryAgain) ? (
        <div className="res-pinned" data-testid="res-pinned">
          {props.onNext ? <NextButton onClick={props.onNext} /> : null}
          {props.onTryAgain ? <Button label={text('action.tryAgainPractice')} onClick={props.onTryAgain} /> : null}
        </div>
      ) : null}
    </div>
  );
}
