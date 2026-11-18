/** The source sheet (04 section 5.12): every credit row for one take, built from the structured source fields. */
import type { AttemptRecord, AttributionsFile, Configs } from '../../../core/types.ts';
import { copy } from '../../../ui/copy/copy.ts';
import { Sheet } from '../../../ui/primitives/index.ts';
import { sourceSheetModel } from './attribution.ts';
import { text } from './text.ts';

export interface SourceSheetProps {
  open: boolean;
  record: AttemptRecord | null;
  configs: Configs;
  /** Null while loading or when attribution is not on the device; the rows that need it then show plain text. */
  attributions?: AttributionsFile | null;
  onClose: () => void;
}

function Link({ href, children }: { href: string | null; children: string }) {
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function SourceSheet({ open, record, configs, attributions, onClose }: SourceSheetProps) {
  if (!record) return null;
  const m = sourceSheetModel(record, configs, attributions ?? null);
  return (
    <Sheet open={open} title={text('source.open')} onClose={onClose}>
      <dl className="src-sheet" data-testid="source-sheet">
        <div className="src-row">
          <dt>{copy('credit.sheet.composer')}</dt>
          <dd>{m.composer}</dd>
        </div>
        <div className="src-row">
          <dt>{copy('credit.sheet.work')}</dt>
          <dd>{m.work}</dd>
        </div>
        <div className="src-row">
          <dt>{copy('credit.sheet.bars')}</dt>
          <dd>{m.bars}</dd>
        </div>
        <div className="src-row">
          <dt>{copy('credit.sheet.collection')}</dt>
          <dd>
            <Link href={m.collection.url}>{m.collection.name}</Link>
          </dd>
        </div>
        <div className="src-row">
          <dt>{copy('credit.sheet.licence')}</dt>
          <dd>
            <Link href={m.licence.url}>{m.licence.label}</Link>
          </dd>
        </div>
        {m.source ? (
          <div className="src-row">
            <dt>{copy('credit.sheet.source')}</dt>
            <dd>
              <Link href={m.source}>{copy('credit.sheet.source')}</Link>
            </dd>
          </div>
        ) : null}
        <div className="src-row">
          <dt>{copy('credit.sheet.adapted')}</dt>
          <dd>{m.adapted}</dd>
        </div>
      </dl>
    </Sheet>
  );
}
