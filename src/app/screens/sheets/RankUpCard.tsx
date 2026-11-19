/** Rank-up card (04 section 5.10): centred 400 px, emblem 96, once per rank. */
import type { Configs } from '../../../core/types.ts';
import { Button } from '../../../ui/components/form/index.ts';
import { RankEmblem } from '../../../ui/components/domain/index.ts';
import { Modal } from '../../../ui/primitives/index.ts';
import { text } from '../results/text.ts';
import './sheets.css';

/** The next rank's requirement from progression.json, or the top-rank line. */
export function nextRankRequirement(cfg: Configs, rank: number): string {
  const next = cfg.progression.ranks.table.find((r) => r.rank === rank + 1);
  if (!next) return text('rankup.top');
  return text('rankup.next', { rank: next.name, xp: next.xp.toLocaleString('en'), level: next.minLevel });
}

export interface RankUpCardProps {
  open: boolean;
  configs: Configs;
  /** The new rank number and name. */
  rank: number;
  name: string;
  onContinue: () => void;
}

export function RankUpCard({ open, configs, rank, name, onContinue }: RankUpCardProps) {
  return (
    <Modal open={open} title={text('rankup.headline', { rank: name })} onClose={onContinue} closeButton={false} size="confirm" className="sheet-card sheet-rankup">
      <div className="sheet-body sheet-center" data-testid="rankup-card">
        <span className="sheet-emblem">
          <RankEmblem rank={rank} state="current" size={96} />
        </span>
        <p className="sheet-note">{nextRankRequirement(configs, rank)}</p>
        <div className="sheet-actions sheet-actions-wide">
          <Button label={text('action.continue')} variant="primary" onClick={onContinue} data-autofocus="" />
        </div>
      </div>
    </Modal>
  );
}
