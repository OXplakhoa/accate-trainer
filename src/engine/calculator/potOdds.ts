import { CalculatorError, type DecisionSnapshot } from './types';

export interface PotOddsInput {
  /** Pot currently in the middle, ALREADY including the bet/raise hero is facing. */
  readonly potBeforeCall: number;
  /** Additional chips hero must put in to call. */
  readonly callAmount: number;
}

export interface PotOddsResult {
  readonly hasCall: boolean;
  readonly potBeforeCall: number;
  readonly callAmount: number;
  readonly potAfterCall: number;
  /** Break-even equity in [0, 1]. Guaranteed finite (0 when callAmount === 0). */
  readonly requiredEquity: number;
  /** Break-even equity in percentage [0, 100]. Guaranteed finite. */
  readonly requiredEquityPercent: number;
  /**
   * Pot-to-call ratio `x` in `x-to-1` (`potBeforeCall / callAmount`).
   * `null` when `callAmount === 0` to avoid NaN / Infinity in UI-bound values.
   */
  readonly potToCallRatio: number | null;
  /**
   * Odds against calling `(1 - p) / p = potBeforeCall / callAmount`.
   * `null` when `callAmount === 0` to avoid NaN / Infinity.
   */
  readonly oddsAgainst: number | null;
  /** Human-readable Vietnamese/poker display label (e.g. "7-to-1", "2.33-to-1", "Không cần call"). */
  readonly potToCallLabel: string;
}

function formatRatioValue(value: number): string {
  if (Number.isInteger(value)) {
    return `${value}-to-1`;
  }
  const rounded = Math.round(value * 100) / 100;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '')}-to-1`;
}

/**
 * Calculates pot odds using `callAmount / (potBeforeCall + callAmount)`,
 * where `potBeforeCall` already includes the bet hero is facing.
 *
 * When `callAmount === 0` (no bet to call), returns `hasCall: false`, `requiredEquity: 0`,
 * `potToCallRatio: null`, and `oddsAgainst: null` so UI callers never receive NaN or Infinity.
 */
export function calculatePotOdds(input: PotOddsInput): PotOddsResult {
  const { potBeforeCall, callAmount } = input;

  if (!Number.isFinite(potBeforeCall) || potBeforeCall < 0) {
    throw new CalculatorError(
      'invalid-pot-odds-input',
      `potBeforeCall must be a finite non-negative number, received ${String(potBeforeCall)}`,
    );
  }
  if (!Number.isFinite(callAmount) || callAmount < 0) {
    throw new CalculatorError(
      'invalid-pot-odds-input',
      `callAmount must be a finite non-negative number, received ${String(callAmount)}`,
    );
  }

  if (callAmount === 0) {
    return Object.freeze({
      hasCall: false,
      potBeforeCall,
      callAmount: 0,
      potAfterCall: potBeforeCall,
      requiredEquity: 0,
      requiredEquityPercent: 0,
      potToCallRatio: null,
      oddsAgainst: null,
      potToCallLabel: 'Không cần call',
    });
  }

  const potAfterCall = potBeforeCall + callAmount;
  const requiredEquity = callAmount / potAfterCall;
  const potToCallRatio = potBeforeCall / callAmount;

  return Object.freeze({
    hasCall: true,
    potBeforeCall,
    callAmount,
    potAfterCall,
    requiredEquity,
    requiredEquityPercent: requiredEquity * 100,
    potToCallRatio,
    oddsAgainst: potToCallRatio,
    potToCallLabel: formatRatioValue(potToCallRatio),
  });
}

/**
 * Calculates pot odds directly from a `DecisionSnapshot`.
 */
export function calculatePotOddsFromSnapshot(snapshot: DecisionSnapshot): PotOddsResult {
  return calculatePotOdds({
    potBeforeCall: snapshot.potBeforeCall,
    callAmount: snapshot.callAmount,
  });
}
