/** Session summary (04 section 5.10): takes, average, XP, best take, top patterns, streak, optional focus card. */
import { Button } from '../../../ui/components/form/index.ts';
import { Modal } from '../../../ui/primitives/index.ts';
import { Link } from '../../router.tsx';
import { text } from '../results/text.ts';
import type { SessionSummaryData } from './summary.ts';
import './sheets.css';

export interface SessionSummaryProps {
  open: boolean;
  data: SessionSummaryData;
  onKeepGoing: () => void;
  onFinish: () => void;
}

export function SessionSummary({ open, data, onKeepGoing, onFinish }: SessionSummaryProps) {
  return (
    <Modal open={open} title={text('summary.title')} onClose={onKeepGoing} closeButton={false} className="sheet-card">
      <div className="sheet-body" data-testid="session-summary">
        {data.takes === 0 ? (
          <p className="sheet-note">{text('summary.empty')}</p>
        ) : (
          <>
            <ul className="sheet-stats">
              <li data-stat="takes">{text('summary.takes', { n: data.takes })}</li>
              {data.averageScore !== null ? <li data-stat="average">{text('summary.average', { score: data.averageScore })}</li> : null}
              <li data-stat="xp">{text('summary.xp', { xp: data.xp })}</li>
              <li data-stat="streak">{data.streakDays > 0 ? text('summary.streak', { days: data.streakDays }) : text('summary.streak.none')}</li>
            </ul>
            {data.best ? (
              <p className="sheet-best" data-testid="summary-best">
                <Link to={`/history/${data.best.attemptId}`}>{text('summary.best', { score: data.best.score, title: data.best.title })}</Link>
              </p>
            ) : null}
            {data.patterns.length ? (
              <section aria-label={text('summary.patterns')}>
                <h3 className="sheet-heading">{text('summary.patterns')}</h3>
                <ol className="sheet-patterns">
                  {data.patterns.map((p) => (
                    <li key={p.id} data-pattern={p.id}>
                      {text('summary.pattern', { pattern: p.name, n: p.count })}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {data.focus ? (
              <p className="sheet-focus" data-testid="summary-focus">
                {text('session.focusCard', { pattern: data.focus.name })}
              </p>
            ) : null}
          </>
        )}
        <div className="sheet-actions">
          <Button label={text('action.keepGoing')} variant="primary" onClick={onKeepGoing} data-autofocus="" />
          <Button label={text('action.finish')} onClick={onFinish} />
        </div>
      </div>
    </Modal>
  );
}
