// expect: none
import { stub } from '../grade/stub.ts';
export const t = [Date.now(), Math.random(), performance.now(), stub];
