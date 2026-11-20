import { useState } from 'react';
import { copy } from '../../copy/copy.ts';
import { Button } from '../form/Button.tsx';
import { DiagnosticsDialog, diagnosticsTitle } from './DiagnosticsDialog.tsx';
import type { DiagnosticsButtonServices } from './types.ts';

export interface DiagnosticsButtonProps {
  services: DiagnosticsButtonServices;
  /** The try to export; omitted: the last try. */
  tryId?: string;
  className?: string;
  /** Force the dialog layout (the story pages). */
  layout?: 'auto' | 'dialog' | 'sheet';
}

/** The tertiary "Save diagnostics" button ("Send diagnostics" with a support address) and its dialog. */
export function DiagnosticsButton({ services, tryId, className, layout }: DiagnosticsButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="quiet" label={diagnosticsTitle(services)} {...(className ? { className } : {})} onClick={() => setOpen(true)} aria-haspopup="dialog" />
      <DiagnosticsDialog open={open} onClose={() => setOpen(false)} services={services} tryId={tryId} {...(layout ? { layout } : {})} />
    </>
  );
}

/** The prompt above the button: "Marks look wrong? Save what the app heard for the team." (or "Send us ..."). */
export function diagnosticsPrompt(services: Pick<DiagnosticsButtonServices, 'supportAddress'>): string {
  return services.supportAddress ? copy('diagnostics.prompt.send') : copy('diagnostics.prompt');
}
