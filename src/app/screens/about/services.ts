/**
 * What the credits page and the source sheet need. Attribution is read from the corpus attributions file, which the
 * composition root fetches from the manifest's reference (01 section 6.3).
 */
import type { AttributionsFile, Configs } from '../../../core/types.ts';

export interface CreditsServices {
  configs: Configs;
  /** Resolves the attributions file. Rejects when it cannot be read; the page then says so. */
  loadAttributions(): Promise<AttributionsFile>;
  /** Address for "Report a rights problem". Omitted: the link is not shown. */
  rightsContact?: string;
}
