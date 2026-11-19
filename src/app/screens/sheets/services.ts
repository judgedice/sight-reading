/** What the `#/practice/tips` redirect needs from the composition root. Tips live in results now (decision 13). */
import type { StoreApi } from 'zustand/vanilla';
import type { SessionView } from '../../../session/index.ts';

export interface TipsServices {
  /** Whether a result is open decides where the redirect goes. */
  session: StoreApi<SessionView>;
}
