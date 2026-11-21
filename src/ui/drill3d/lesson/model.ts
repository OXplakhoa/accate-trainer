import type { DemoSpot } from '../contract';

export type Action = 'Call' | 'Fold';
export type Level = 1 | 3;
export type Outcome = Action | 'expired';

export const DURATION_MS = 20_000;
export const cardsUnseen = 46;
export const exactPercent = (spot: DemoSpot) => (spot.outs / cardsUnseen) * 100;
export const requiredPercent = (spot: DemoSpot) => (spot.call / (spot.pot + spot.call)) * 100;
export const correctAction = (spot: DemoSpot): Action =>
  exactPercent(spot) >= requiredPercent(spot) ? 'Call' : 'Fold';
export const secondsRemaining = (deadline: number, now: number) =>
  Math.max(0, Math.ceil((deadline - now) / 1000));
