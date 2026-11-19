/**
 * What a past take scored, read-only (05 section 8.12): the grade, the three components, the counts, the XP it earned
 * and, for a take that was not graded, the card that says so. The marked score and Listen sit above it.
 */
import type { AttemptRecord, Configs, PlayerProfile } from '../../../core/types.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { ComponentBar, StarRow } from '../../../ui/components/domain/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { componentRows, countParts, creditLine, diagnosticLines, focusComponent, xpView } from '../results/model.ts';
import { NotGradedResult, VoidCard } from '../states/index.ts';

export interface SummaryProps {
  record: AttemptRecord;
  configs: Configs;
  profile?: PlayerProfile | undefined;
  /** Practise this excerpt again. Omitted: the action is not shown. */
  onPlayAgain?: (() => void) | undefined;
}

export function Summary({ record, configs, profile, onPlayAgain }: SummaryProps) {
  const s = record.score;
  const again = onPlayAgain ? (
    <div className="hist-actions">
      <Button label={copy('action.playThisAgain')} variant="primary" onClick={onPlayAgain} />
    </div>
  ) : null;

  // A void take has no grade: the card says why.
  if (record.endReason === 'void' && record.voidReason) {
    return (
      <div className="hist-summary" data-testid="attempt-summary" data-state="void">
        <VoidCard reason={record.voidReason} />
        {again}
      </div>
    );
  }
  // Practised without listening: nothing was judged.
  if (!record.listening || !s) {
    return (
      <div className="hist-summary" data-testid="attempt-summary" data-state="not-graded">
        <NotGradedResult credit={creditLine(record.credit)} />
        {again}
      </div>
    );
  }

  const instrument = configs.instrumentById[record.instrumentId];
  const rows = componentRows(record, instrument);
  const focus = focusComponent(s);
  const counts = countParts(s);
  const diagnostics = diagnosticLines(s);
  const xp = xpView(record, configs, profile).headline;
  return (
    <div className="hist-summary" data-testid="attempt-summary" data-state="graded">
      <section className="hist-grade-block" aria-label={copy('a11y.grade.heading', { grade: s.grade, score: Math.round(s.score), stars: s.stars })}>
        <span className="hist-grade-letter" aria-hidden="true">
          {s.grade}
        </span>
        <span className="hist-grade-score" aria-hidden="true">
          {Math.round(s.score)}
        </span>
        <div className="hist-grade-side" aria-hidden="true">
          <StarRow stars={s.stars} shine={s.shine} size="results" />
          <p className="hist-grade-line">{copy(`grade.${s.grade}`)}</p>
        </div>
      </section>

      <div className="hist-components" data-testid="attempt-components">
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

      {diagnostics.length > 0 ? (
        <ul className="hist-diagnostics">
          {diagnostics.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
      <p className="hist-counts" data-testid="attempt-counts">
        {counts.map((c) => c.label).join(' · ')}
      </p>
      {xp ? <p className="hist-xp">{xp}</p> : null}
      {again}
    </div>
  );
}
