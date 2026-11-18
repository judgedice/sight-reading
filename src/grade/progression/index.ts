/** G6 and G7: progression and ranked eligibility. `grade/index` re-exports these with `grade()`. */
export { applyAttempt, applyAttemptOnDay } from './apply.ts';
export { effectiveStreakDays } from './days.ts';
export { evaluateGate, hasSeen, postRevealSkipAllowed, reasonForGate, xpInputFor } from './eligibility.ts';
export type { GateInput } from './eligibility.ts';
export { createProfile, newInstrumentProgress, respondToLevelOffer, setInstrumentLevel, startPlacement } from './profile.ts';
export { maxLevelOf, profileRank, rankFor } from './rank.ts';
