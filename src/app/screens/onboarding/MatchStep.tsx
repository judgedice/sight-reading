import '../match/match.css';
import type { Configs, Instrument } from '../../../core/types.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { MatchPanel } from '../match/MatchPanel.tsx';
import { useMatch } from '../match/use-match.ts';
import { otherVoiceOffer } from '../match/view.ts';
import type { OnboardingServices } from './services.ts';

export interface MatchStepProps {
  services: NonNullable<OnboardingServices['match']>;
  instrument: Instrument;
  cfg: Configs;
  /** Continue after a hit. */
  onContinue: () => void;
  /** "Choose tenor": the player's notes sat above this voice. */
  onChangeVoice: (instrumentId: string) => void;
}

/**
 * Onboarding step "Sing one note" or "Play one note" (01-ux §3.2, 04-design §4): one note, not a round. It doubles as
 * the microphone check. It never moves on by itself: Continue shows after a hit, and Skip is in the step's header.
 * Nothing is graded or stored.
 */
export function MatchStep({ services, instrument, cfg, onContinue, onChangeVoice }: MatchStepProps) {
  const ctl = useMatch(services, instrument, 'onboarding');
  const offer = otherVoiceOffer(ctl.state, cfg, instrument);
  return (
    <section className="ob-match" data-testid="ob-match">
      <p className="ob-text ob-match-lead">{copy('match.onboarding.lead')}</p>
      <MatchPanel
        ctl={ctl}
        instrument={instrument}
        cfg={cfg}
        chips={false}
        aside={
          offer ? (
            <p className="mt-offer" data-testid="ob-other-voice">
              <span>{offer.text}</span>
              <Button label={offer.action} variant="tonal" size="compact" onClick={() => onChangeVoice(offer.other.id)} />
            </p>
          ) : null
        }
        actions={ctl.everHit ? <Button label={copy('action.continue')} variant="primary" icon="arrow-right" onClick={onContinue} /> : null}
      />
    </section>
  );
}
