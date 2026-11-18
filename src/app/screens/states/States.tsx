import './states.css';
import type { ReactNode } from 'react';
import type { VoidReason } from '../../../core/types.ts';
import { Banner, Card } from '../../../ui/components/containers/index.ts';
import { EmptyState } from '../../../ui/components/domain/index.ts';
import { Button } from '../../../ui/components/form/index.ts';
import type { GlyphId } from '../../../ui/glyph-ids.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { deniedStepsKey, micProblemKey, type MicBrowser, type MicProblem } from './mic.ts';
import { text, type TextKey } from './text.ts';
import { voidCopy, type VoidAction } from './void.ts';

export interface StateAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

function StateCard({ icon, tone, heading, body, steps, actions, testId }: {
  icon: GlyphId;
  tone: 'caution' | 'danger' | 'info';
  heading?: string;
  body: string;
  steps?: string;
  actions: readonly StateAction[];
  testId: string;
}) {
  return (
    <Card className={`state-card state-card-${tone}`}>
      <section data-testid={testId} role={tone === 'danger' ? 'alert' : 'status'} className="state-card-inner">
        <Glyph id={icon} size={32} className="state-card-icon" />
        {heading ? <h2 className="state-card-heading">{heading}</h2> : null}
        <p className="state-card-body">{body}</p>
        {steps ? <p className="state-card-steps">{steps}</p> : null}
        {actions.length ? (
          <div className="state-card-actions">
            {actions.map((a) => (
              <Button key={a.label} label={a.label} variant={a.primary ? 'primary' : 'secondary'} onClick={a.onClick} />
            ))}
          </div>
        ) : null}
      </section>
    </Card>
  );
}

// ---- microphone permission (9.2) -----------------------------------------------------------

export interface MicProblemCardProps {
  problem: MicProblem;
  /** Which unblock steps to show for `denied`. */
  browser?: MicBrowser;
  onTryAgain?: () => void;
  /** Offered on `denied` (R13). */
  onPractiseWithoutListening?: () => void;
}

/** The denied, no-device, busy and insecure cards. Denied shows the browser steps and both actions. */
export function MicProblemCard({ problem, browser = 'chrome', onTryAgain, onPractiseWithoutListening }: MicProblemCardProps) {
  const actions: StateAction[] = [];
  if (onTryAgain && problem !== 'insecure') actions.push({ label: text('action.tryAgain'), onClick: onTryAgain, primary: true });
  if (onPractiseWithoutListening && problem === 'denied') {
    actions.push({ label: text('action.practiseWithoutListening'), onClick: onPractiseWithoutListening });
  }
  return (
    <StateCard
      testId={`mic-${problem}`}
      icon="mic-off"
      tone="danger"
      body={text(problem === 'denied' ? 'permission.denied.title' : micProblemKey(problem))}
      {...(problem === 'denied' ? { steps: text(deniedStepsKey(browser)) } : {})}
      actions={actions}
    />
  );
}

/** The "Microphone off" Home banner (5.1 step 3, "Not now"), with a way back to the pre-prompt. */
export function MicOffBanner({ onAllow }: { onAllow: () => void }) {
  return <Banner tone="caution" text={text('banner.micOff')} action={{ label: text('action.allowMicrophone'), onClick: onAllow }} />;
}

// ---- void and errors (9.3) -----------------------------------------------------------------

export interface VoidCardProps {
  reason: VoidReason;
  onTryAgain?: () => void;
  onCheckMicrophone?: () => void;
  onRecalibrate?: () => void;
}

/** Results void card: says why the take wasn't graded and the next step. Never shown with a grade. */
export function VoidCard({ reason, onTryAgain, onCheckMicrophone, onRecalibrate }: VoidCardProps) {
  const { key, actions } = voidCopy(reason);
  const handlers: Record<VoidAction, { key: TextKey; fn: (() => void) | undefined }> = {
    'try-again': { key: 'action.tryAgain', fn: onTryAgain },
    'check-microphone': { key: 'action.checkMicrophone', fn: onCheckMicrophone },
    recalibrate: { key: 'action.recalibrate', fn: onRecalibrate },
  };
  const list: StateAction[] = [];
  actions.forEach((a, i) => {
    const h = handlers[a];
    if (h.fn) list.push({ label: text(h.key), onClick: h.fn, primary: i === 0 });
  });
  return <StateCard testId={`void-${reason}`} icon="alert-triangle" tone="caution" body={text(key)} actions={list} />;
}

export type ErrorKind = 'clock-rate' | 'corpus' | 'no-worklet' | 'storage-loss' | 'storage-blocked';

const ERROR_BODY: Record<ErrorKind, TextKey> = {
  'clock-rate': 'error.clockRate',
  corpus: 'error.corpus',
  'no-worklet': 'error.noAudioWorklet',
  'storage-loss': 'banner.storageLoss',
  'storage-blocked': 'error.storageBlocked',
};

export interface ErrorCardProps {
  kind: ErrorKind;
  /** clock-rate: Reload. corpus: Retry. storage-loss: Import backup. storage-blocked: Export this take. */
  onPrimary?: () => void;
  /** no-worklet: Practise without listening. storage-loss: Start fresh. */
  onSecondary?: () => void;
}

/** Full cards for the errors that stop a screen (reload, retry, import, export), each with its next step. */
export function ErrorCard({ kind, onPrimary, onSecondary }: ErrorCardProps) {
  const primaryLabel: Record<ErrorKind, TextKey> = {
    'clock-rate': 'action.reload',
    corpus: 'action.retry',
    'no-worklet': 'action.practiseWithoutListening',
    'storage-loss': 'action.importBackup',
    'storage-blocked': 'action.exportThisTake',
  };
  const actions: StateAction[] = [];
  if (onPrimary) actions.push({ label: text(primaryLabel[kind]), onClick: onPrimary, primary: true });
  if (onSecondary && kind === 'storage-loss') actions.push({ label: text('action.startFresh'), onClick: onSecondary });
  return (
    <StateCard
      testId={`error-${kind}`}
      icon={kind === 'storage-loss' || kind === 'storage-blocked' ? 'alert-triangle' : 'alert-octagon'}
      tone={kind === 'storage-loss' || kind === 'storage-blocked' ? 'caution' : 'danger'}
      body={text(ERROR_BODY[kind])}
      actions={actions}
    />
  );
}

// ---- banners (9.3) -------------------------------------------------------------------------

export function ClippingBanner() {
  return <Banner tone="caution" text={text('results.banner.clipping')} />;
}

export function RejudgedBanner() {
  return <Banner tone="caution" text={text('results.rejudged.banner')} />;
}

export function RecheckShiftBanner({ onRecalibrate }: { onRecalibrate: () => void }) {
  return <Banner tone="caution" text={text('results.banner.recheckShift')} action={{ label: text('action.recalibrate'), onClick: onRecalibrate }} />;
}

/** Home banner when no fresh calibration exists. `seconds` comes from the calibration run's length. Never blocks Start. */
export function CalibrationMissingBanner({ seconds, onCalibrate, onDismiss }: { seconds: number; onCalibrate: () => void; onDismiss?: () => void }) {
  return (
    <Banner
      tone="info"
      text={text('banner.calibrateNeeded', { seconds })}
      action={{ label: text('action.calibrate'), onClick: onCalibrate }}
      dismissible
      {...(onDismiss ? { onDismiss } : {})}
    />
  );
}

export function BluetoothBanner({ onRecalibrate }: { onRecalibrate: () => void }) {
  return <Banner tone="caution" text={text('banner.bluetooth')} action={{ label: text('action.recalibrate'), onClick: onRecalibrate }} />;
}

/** The "storage blocked" notice with its action; the host shows it as a toast after an attempt, then in Settings > Data. */
export function StorageBlockedBanner({ onExport }: { onExport: () => void }) {
  return <Banner tone="caution" text={text('error.storageBlocked')} action={{ label: text('action.exportThisTake'), onClick: onExport }} />;
}

// ---- empty states (9.1) --------------------------------------------------------------------

export function ProgressEmpty({ onStart }: { onStart: () => void }) {
  return <EmptyState icon="play" title={text('empty.progress.title')} body={text('empty.progress.body')} action={<Button label={text('action.startPractising')} variant="primary" onClick={onStart} />} />;
}

export function HistoryEmpty({ onStart }: { onStart: () => void }) {
  return <EmptyState icon="play" title={text('empty.history.title')} body={text('empty.history.body')} action={<Button label={text('action.startPractising')} variant="primary" onClick={onStart} />} />;
}

export function HistoryFilteredEmpty({ onClear }: { onClear: () => void }) {
  return <EmptyState icon="info" title={text('empty.historyFiltered.title')} body={text('empty.historyFiltered.body')} action={<Button label={text('action.clearFilters')} onClick={onClear} />} />;
}

/** Common slips with fewer than 3 attempts: no action. */
export function SlipsEmpty() {
  return <EmptyState icon="info" title={text('empty.slips.title')} body={text('empty.slips.body')} />;
}

export interface SelectorSuggestion {
  label: string;
  onSelect: () => void;
}

/** `empty-pool`: the body is built from the selector's reason, one button per suggestion. */
export function SelectorEmpty({ body, suggestions }: { body: string; suggestions: readonly SelectorSuggestion[] }) {
  const action: ReactNode = suggestions.length ? (
    <div className="state-card-actions">
      {suggestions.map((s) => (
        <Button key={s.label} label={s.label} onClick={s.onSelect} />
      ))}
    </div>
  ) : null;
  return <EmptyState icon="info" title={text('empty.selector.title')} body={body} {...(action ? { action } : {})} />;
}

// ---- practise without listening (R13) ------------------------------------------------------

/** Shown on scan and play when no capture runs. */
export function PractiseWithoutListeningNotice() {
  return (
    <p className="state-notice" data-testid="practise-notice">
      <Glyph id="mic-off" size={16} />
      <span>{text('practise.notice')}</span>
    </p>
  );
}

/** The results line for a take that was not listened to: "Not graded · no XP". No grade, no XP, no self-assessment. */
export function NotGradedResult({ credit }: { credit?: string }) {
  return (
    <section className="state-notgraded" data-testid="not-graded" aria-label={text('practise.heading')}>
      <h2 className="state-notgraded-title">{text('results.notGraded')}</h2>
      {credit ? <p className="state-notgraded-credit">{text('credit.that-was', { credit })}</p> : null}
    </section>
  );
}
