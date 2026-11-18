/**
 * What the progress screen needs from the composition root. Progress reads the profile only; the composition root
 * keeps the profile store current after every attempt (04 section 5.7).
 */
import type { Configs, PlayerProfile } from '../../../core/types.ts';
import type { Readable } from '../home/services.ts';

export interface ProgressServices {
  configs: Configs;
  profile: Readable<PlayerProfile | undefined>;
}
