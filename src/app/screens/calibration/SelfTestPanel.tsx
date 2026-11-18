import './calibration.css';
import { useState } from 'react';
import { Card } from '../../../ui/components/containers/index.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { text, type TextKey } from '../states/text.ts';
import type { CalibrationServices, SelfTestItemId, SelfTestOutcome } from './services.ts';

export const SELF_TEST_LABEL: Record<SelfTestItemId, TextKey> = {
  'sanity-tone': 'calibrate.check.sanityTone',
  clicks: 'calibrate.check.clicksHeard',
  recheck: 'calibrate.check.countInRecheck',
  'clock-rate': 'calibrate.check.clockRate',
  processing: 'calibrate.check.micProcessingOff',
  'frame-rate': 'calibrate.check.screenRefresh',
};

const STATUS_KEY = { pass: 'calibrate.selfTest.pass', fail: 'calibrate.selfTest.fail', skipped: 'calibrate.selfTest.skipped' } as const;

/** Audio self-test (04 section 5.9 item 7): [Check audio], a pass/fail list, [Export diagnostics] (no audio). */
export function SelfTestPanel({ services }: { services: CalibrationServices }) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<SelfTestOutcome | null>(null);

  const check = (): void => {
    // Unlock first, inside the click (05 W1); the run follows.
    const unlocked = services.unlock();
    setPhase('running');
    void (async () => {
      try {
        await unlocked;
        const r = await services.runSelfTest();
        if (r.calibration) await services.save(r.calibration);
        setResult(r);
        setPhase('done');
      } catch {
        setPhase('error');
      }
    })();
  };

  return (
    <Card className="cal-card">
      <section className="cal" data-testid="self-test">
        <h2 className="cal-title">{text('calibrate.selfTest.title')}</h2>
        <div className="cal-actions">
          <Button label={text('action.checkAudio')} variant="secondary" loading={phase === 'running'} onClick={check} />
          {result ? <Button label={text('action.exportDiagnostics')} variant="tertiary" onClick={() => services.exportDiagnostics(result.diagnosticsJson)} /> : null}
        </div>
        {phase === 'running' ? <p role="status">{text('calibrate.selfTest.running')}</p> : null}
        {phase === 'error' ? <p role="alert">{text('calibrate.fail.error')}</p> : null}
        {result ? (
          <>
            <ul className="cal-checks">
              {result.items.map((i) => (
                <li key={i.id} className="cal-check" data-status={i.status}>
                  <span>{text(SELF_TEST_LABEL[i.id])}</span>
                  <span className="cal-check-status">{text(STATUS_KEY[i.status])}</span>
                </li>
              ))}
            </ul>
            <p role="status">{text(result.passed ? 'calibrate.selfTest.summaryPass' : 'calibrate.selfTest.summaryFail')}</p>
          </>
        ) : null}
      </section>
    </Card>
  );
}
