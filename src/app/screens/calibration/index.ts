export { CalibrationCard, type CalibrationCardProps, type CalibrationResult } from './CalibrationCard.tsx';
export { CalibrationScreen } from './CalibrationScreen.tsx';
export { CalibrationServicesProvider, useCalibrationServices } from './services.ts';
export type { AudioPrefs, CalibrationServices, CalPlan, CalProgress, CalStageId, LoopbackOutcome, PlayAlongOutcome, SelfTestItemId, SelfTestOutcome } from './services.ts';
export { calReducer, calibrationIsMandatoryPath, initialCalState, methodFor, offsetTick, stageStatuses, warningsFor } from './flow.ts';

import type { ScreenOverrides } from '../../routes.tsx';
import { CalibrationScreen } from './CalibrationScreen.tsx';

/** Route overrides for `createRouteTable` (D1 notes): the calibrate route. */
export const calibrationRoutes: ScreenOverrides = { calibrate: CalibrationScreen };
