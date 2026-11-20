import './states.css';
import { useEffect, useRef, type ReactNode } from 'react';
import type { VoidReason } from '../../../core/types.ts';
import { Banner, Card } from '../../../ui/components/containers/index.ts';
import { EmptyState } from '../../../ui/components/domain/index.ts';
import { Button } from '../../../ui/components/form/index.ts';
import type { GlyphId } from '../../../ui/glyph-ids.ts';
import { DiagnosticsButton, type DiagnosticsButtonServices } from '../../../ui/components/diagnostics/index.ts';
import { Glyph } from '../../../ui/primitives/index.ts';
import { deniedStepsKey, micProblemKey, type MicBrowser, type MicProblem } from './mic.ts';
import { text, type TextKey } from './text.ts';
import { voidCopy, type VoidAction } from './void.ts';

export interface StateAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
  /** A glyph before the label (Try again on the error screens). */
  icon?: GlyphId;
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

export type ErrorKind = 'storage-loss' | 'storage-blocked';

export interface ErrorCardProps {
  kind: ErrorKind;
  /** storage-loss: Import backup. storage-blocked: Export this take. */
  onPrimary?: () => void;
  /** storage-loss: Start fresh. */
  onSecondary?: () => void;
}

/** Cards for the storage errors, which do not stop the loop: each carries its next step. */
export function ErrorCard({ kind, onPrimary, onSecondary }: ErrorCardProps) {
  const lost = kind === 'storage-loss';
  const actions: StateAction[] = [];
  if (onPrimary) actions.push({ label: text(lost ? 'action.importBackup' : 'action.exportThisTake'), onClick: onPrimary, primary: true });
  if (onSecondary && lost) actions.push({ label: text('action.startFresh'), onClick: onSecondary });
  return (
    <StateCard
      testId={`error-${kind}`}
      icon="alert-triangle"
      tone="caution"
      body={text(lost ? 'banner.storageLoss' : 'error.storageBlocked')}
      actions={actions}
    />
  );
}

// ---- full-screen errors (05 section 8.13) ------------------------------------------------------

export interface ErrorScreenProps {
  /** Which glyph sits in the tile above the heading. */
  icon?: GlyphId;
  heading: string;
  /** The cause, in one or two sentences. */
  body: string;
  /** Browser-specific steps under the cause (the denied screen). */
  steps?: string;
  /** A reassurance line under the cause ("Your piece is kept..."). */
  note?: string;
  actions: readonly StateAction[];
  /** Rendered under the actions (the diagnostics prompt and button). */
  footer?: ReactNode;
  testId: string;
}

/**
 * A screen that stops the loop: icon tile, heading, the cause and its actions (error-sound, error-mic mockups). The
 * heading takes focus on mount so a screen reader hears the problem first.
 */
export function ErrorScreen({ icon = 'caution', heading, body, steps, note, actions, footer, testId }: ErrorScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), []);
  return (
    <section className="err-screen" data-testid={testId} role="alert">
      <span className="err-screen-icon" aria-hidden="true">
        <Glyph id={icon} size={24} />
      </span>
      <h1 ref={headingRef} tabIndex={-1} className="err-screen-heading">
        {heading}
      </h1>
      <p className="err-screen-body">{body}</p>
      {steps ? <p className="err-screen-steps">{steps}</p> : null}
      {note ? (
        <p className="err-screen-note" data-testid="error-kept">
          <Glyph id="info" size={16} />
          <span>{note}</span>
        </p>
      ) : null}
      <div className="err-screen-actions">
        {actions.map((a) => (
          <Button key={a.label} label={a.label} size="hero" variant={a.primary ? 'primary' : 'secondary'} onClick={a.onClick} {...(a.icon ? { icon: a.icon } : {})} />
        ))}
      </div>
      {footer ? <div className="err-screen-footer">{footer}</div> : null}
    </section>
  );
}

/** `audio-start` and `mic-start` are the two failures that stop a try (01-ux section 9); a clock-rate result never does. */
export type ErrorScreenKind = 'audio-start' | 'mic-start' | 'corpus' | 'no-worklet';

const SCREEN_ERRORS: Record<ErrorScreenKind, { icon: GlyphId; heading: TextKey; body: TextKey; kept?: boolean; diagnostics?: boolean }> = {
  'audio-start': { icon: 'volume-2', heading: 'error.audioStart.title', body: 'error.audioStart.body', kept: true, diagnostics: true },
  'mic-start': { icon: 'mic', heading: 'error.micStart.title', body: 'error.micStart.body', kept: true, diagnostics: true },
  corpus: { icon: 'caution', heading: 'error.corpus.title', body: 'error.corpus' },
  'no-worklet': { icon: 'caution', heading: 'error.noAudioWorklet.title', body: 'error.noAudioWorklet' },
};

export interface ErrorKindScreenProps {
  kind: ErrorScreenKind;
  /** Retries the start that failed; on success the host returns the player to the piece's beginning. */
  onTryAgain: () => void;
  /** Leaves for `#/`. */
  onBackToPractice: () => void;
  /** With it, the sound and microphone screens offer "Save diagnostics" under "Keeps happening?". */
  diagnostics?: DiagnosticsButtonServices;
}

/** The sound-didn't-start, microphone-didn't-open, corpus and no-worklet errors: cause, "Try again", "Back to Practice". */
export function ErrorKindScreen({ kind, onTryAgain, onBackToPractice, diagnostics }: ErrorKindScreenProps) {
  const t = SCREEN_ERRORS[kind];
  return (
    <ErrorScreen
      testId={`error-screen-${kind}`}
      icon={t.icon}
      heading={text(t.heading)}
      body={text(t.body)}
      {...(t.kept ? { note: text('error.kept') } : {})}
      actions={[
        { label: text('action.tryAgain'), onClick: onTryAgain, primary: true, icon: 'retry' },
        { label: text('action.backToPractice'), onClick: onBackToPractice },
      ]}
      {...(t.diagnostics && diagnostics
        ? {
            footer: (
              <>
                <p className="err-screen-prompt">{text('error.diagnostics.prompt')}</p>
                <DiagnosticsButton services={diagnostics} />
              </>
            ),
          }
        : {})}
    />
  );
}

export interface MicDeniedScreenProps {
  browser?: MicBrowser;
  onTryAgain: () => void;
  onPractiseWithoutListening: () => void;
}

/** Microphone denied, from Start or Calibrate: the browser's steps, "Try again" and "Practise without listening". */
export function MicDeniedScreen({ browser = 'chrome', onTryAgain, onPractiseWithoutListening }: MicDeniedScreenProps) {
  return (
    <ErrorScreen
      testId="mic-denied-screen"
      icon="mic"
      heading={text('permission.denied.title')}
      body={text(deniedStepsKey(browser))}
      actions={[
        { label: text('action.tryAgain'), onClick: onTryAgain, primary: true },
        { label: text('action.practiseWithoutListening'), onClick: onPractiseWithoutListening },
      ]}
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
