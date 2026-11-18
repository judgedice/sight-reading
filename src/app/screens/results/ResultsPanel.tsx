/** The results panel (04 section 5.5): grade block, components, diagnostics, XP, rank, level cards and actions. */
import { useState, type ReactNode } from 'react';
import type { AttemptRecord, Configs, PlayerProfile, ProgressEvent, Tip } from '../../../core/types.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { ComponentBar, GradeBadge, RankEmblem, StarRow } from '../../../ui/components/domain/index.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { ClippingBanner, NotGradedResult, RecheckShiftBanner, RejudgedBanner, VoidCard } from '../states/index.ts';
import {
  badgesFor,
  clippingBanner,
  componentRows,
  countParts,
  creditLine,
  diagnosticLines,
  focusComponent,
  levelCards,
  manyRejudged,
  personalBest,
  rankBar,
  rejudgedCount,
  tipPreview,
  xpView,
  type CountKind,
  type LevelCard,
} from './model.ts';
import { text } from './text.ts';
import './results.css';

/** Everything the panel can ask for. All optional: a missing handler hides its control. */
export interface ResultsHandlers {
  onNext?: () => void;
  onTryAgain?: () => void;
  onPlayAgain?: () => void;
  onMoveUp?: (instrumentId: string, to: number) => void;
  onStayAt?: (instrumentId: string, level: number) => void;
  onUndoLevelUp?: (instrumentId: string, from: number) => void;
  onGoToLevel?: (instrumentId: string, level: number) => void;
  onRecalibrate?: () => void;
  onCheckMicrophone?: () => void;
  /** A count in the counts line was pressed: the slip stepper restricts to that verdict (D8b). */
  onSelectVerdict?: (kind: CountKind) => void;
  /** The "re-judged after the take" button was pressed (D8b). */
  onShowRejudged?: () => void;
}

export interface ResultsPanelProps extends ResultsHandlers {
  record: AttemptRecord;
  configs: Configs;
  profile?: PlayerProfile | undefined;
  progress?: readonly ProgressEvent[];
  tips?: readonly Tip[];
  /** History view: no level cards, no Next or Try again, one Play again action. */
  readOnly?: boolean;
  /** Offer recalibration (a recheck marked the calibration stale, R31). */
  recalibrate?: boolean;
  /** Level cards already answered. */
  dismissedCards?: ReadonlySet<string>;
  onDismissCard?: (card: LevelCard) => void;
  /** Extra content under the actions (for example the install coach in tests). */
  children?: ReactNode;
}

export const cardId = (c: LevelCard): string => `${c.kind}:${c.instrumentId}`;

function LevelCards({ cards, h, dismissed, dismiss }: { cards: LevelCard[]; h: ResultsHandlers; dismissed: ReadonlySet<string>; dismiss: (c: LevelCard) => void }) {
  return (
    <>
      {cards.filter((c) => !dismissed.has(cardId(c))).map((c) => (
        <section key={cardId(c)} className="res-level-card" data-testid={`level-${c.kind}`}>
          <p className="res-level-text">{c.text}</p>
          <div className="res-level-actions">
            {c.kind === 'offer' ? (
              <>
                <Button label={text('action.moveUp')} variant="primary" size="compact" onClick={() => { h.onMoveUp?.(c.instrumentId, c.to); dismiss(c); }} />
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
    </>
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

export function ResultsPanel(props: ResultsPanelProps) {
  const { record, configs, profile, progress = [], tips = [], readOnly = false, recalibrate = false } = props;
  const [xpOpen, setXpOpen] = useState(false);
  const [localDismissed, setLocalDismissed] = useState<ReadonlySet<string>>(new Set());
  const dismissed = props.dismissedCards ?? localDismissed;
  const dismiss = (c: LevelCard): void => {
    props.onDismissCard?.(c);
    setLocalDismissed((prev) => new Set(prev).add(cardId(c)));
  };
  const s = record.score;
  const instrument = configs.instrumentById[record.instrumentId];
  const credit = creditLine(record.credit);

  const actions = readOnly ? (
    <div className="res-actions">
      {props.onPlayAgain ? <Button label={text('action.playThisAgain')} variant="primary" onClick={props.onPlayAgain} /> : null}
    </div>
  ) : (
    <div className="res-actions">
      {props.onNext ? <Button label={text('action.nextExcerpt')} variant="primary" size="hero" onClick={props.onNext} data-autofocus="" /> : null}
      {props.onTryAgain ? (
        <span title={text('results.practice.tooltip')} className="res-try-again">
          <Button label={text('action.tryAgainPractice')} onClick={props.onTryAgain} />
        </span>
      ) : null}
    </div>
  );

  // ---- void: no grade, the void card (9.3) -------------------------------------------------
  if (record.endReason === 'void' && record.voidReason) {
    return (
      <div className="res-panel" data-testid="results-panel" data-state="void">
        <VoidCard
          reason={record.voidReason}
          {...(props.onTryAgain ? { onTryAgain: props.onTryAgain } : {})}
          {...(props.onCheckMicrophone ? { onCheckMicrophone: props.onCheckMicrophone } : {})}
          {...(props.onRecalibrate ? { onRecalibrate: props.onRecalibrate } : {})}
        />
        {props.children}
      </div>
    );
  }

  // ---- practise without listening: "Not graded · no XP" ------------------------------------
  if (!record.listening || !s) {
    return (
      <div className="res-panel" data-testid="results-panel" data-state="not-graded">
        <NotGradedResult credit={credit} />
        {actions}
        {props.children}
      </div>
    );
  }

  const rows = componentRows(record, instrument);
  const focus = focusComponent(s);
  const badges = badgesFor(record, configs);
  const best = personalBest(progress, record.instrumentId);
  const xp = xpView(record, configs, profile);
  const bar = profile ? rankBar(configs, profile) : null;
  const diagnostics = diagnosticLines(s);
  const preview = tipPreview(configs, tips);
  const cards = readOnly ? [] : levelCards(progress, record.instrumentId, configs);
  const percent = bar ? Math.round(bar.fraction * 100) : 0;

  return (
    <div className="res-panel" data-testid="results-panel" data-state="graded">
      {best ? (
        <p className="res-ribbon" data-testid="res-ribbon">
          <Glyph id="check-circle" size={16} />
          <span>{best}</span>
        </p>
      ) : null}

      <section className="res-grade" aria-label={text('a11y.grade.heading', { grade: s.grade, score: s.score, stars: s.stars })}>
        <GradeBadge grade={s.grade} score={s.score} size={72} stars={s.stars} />
        <div className="res-grade-side">
          <StarRow stars={s.stars} shine={s.shine} size="results" />
          <p className="res-grade-line">{text(`grade.${s.grade}`)}</p>
        </div>
      </section>

      <ul className="res-badges" aria-label={text('badge.ranked')}>
        {badges.map((b) => (
          <li key={b.kind} className="res-badge" data-kind={b.kind} {...(b.tooltip ? { title: b.tooltip } : {})}>
            <span className="res-badge-label">{b.label}</span>
            {b.detail ? <span className="res-badge-detail">{b.detail}</span> : null}
          </li>
        ))}
      </ul>

      {clippingBanner(record, configs) ? <ClippingBanner /> : null}
      {manyRejudged(record) ? <RejudgedBanner /> : null}
      {(recalibrate || record.calibration.recheck?.promptRecalibrate) && props.onRecalibrate ? <RecheckShiftBanner onRecalibrate={props.onRecalibrate} /> : null}

      <div className="res-components" data-testid="res-components">
        {rows.map((r) => (
          <ComponentBar
            key={r.id}
            label={r.label}
            value={r.value}
            explainer={r.explainer}
            {...(r.detail ? { detail: r.detail } : {})}
            {...(r.unavailableText ? { unavailableText: r.unavailableText } : {})}
            focus={r.id === focus}
          />
        ))}
      </div>

      {diagnostics.length ? (
        <ul className="res-diagnostics" data-testid="res-diagnostics">
          {diagnostics.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}

      <Counts record={record} h={props} />

      {preview ? (
        <p className="res-tip" data-testid="res-tip">
          <span className="res-tip-line">{preview.line}</span>
          <span className="res-tip-evidence">{preview.evidence}</span>
        </p>
      ) : null}

      {xp.headline ? (
        <section className="res-xp" data-testid="res-xp">
          <div className="res-xp-head">
            <p className="res-xp-headline">{xp.headline}</p>
            {xp.factors.length ? (
              <button type="button" className="res-xp-toggle" aria-expanded={xpOpen} aria-controls="res-xp-factors" onClick={() => setXpOpen(!xpOpen)}>
                {text('results.xp.details')}
              </button>
            ) : null}
          </div>
          <ul id="res-xp-factors" className="res-xp-factors" hidden={!xpOpen}>
            {xp.factors.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {bar ? (
        <section className="res-rank" data-testid="res-rank">
          <RankEmblem rank={bar.rank} state="current" size={24} />
          <div className="res-rank-body">
            <div
              className="res-rank-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={bar.label}
            >
              <div className="res-rank-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="res-rank-label">{bar.label}</p>
          </div>
          <span className="res-rank-pct">{`${percent}%`}</span>
        </section>
      ) : null}

      {cards.length ? <LevelCards cards={cards} h={props} dismissed={dismissed} dismiss={dismiss} /> : null}

      {actions}
      {props.children}
    </div>
  );
}
