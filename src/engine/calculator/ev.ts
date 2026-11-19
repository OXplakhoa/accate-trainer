import {
  BET_STEP,
  MAX_PREFLOP_CAP,
  MIN_PREFLOP_CAP,
  STREET_CAP,
  type Street,
} from '../handTypes';
import {
  CalculatorError,
  type CalculationAssumptions,
  type DecisionAssumptionsContext,
  type RangeAssumptionSummary,
} from './types';

export type EvPrecision = 'exact' | 'estimated';

export interface FoldEvResult {
  readonly action: 'fold';
  readonly ev: 0;
  readonly precision: 'exact';
  readonly assumptions: CalculationAssumptions;
}

export interface CallEvInput {
  /** Pot currently in the middle that hero is eligible to win (already includes bet hero faces). */
  readonly potBeforeCall: number;
  /** Additional chips hero must put in to call. */
  readonly callAmount: number;
  /** Hero's showdown equity in [0, 1] for this pot. */
  readonly equity: number;
  /** Optional legality checks against hero stack and street cap. */
  readonly heroStack?: number;
  readonly heroStreetContribution?: number;
  readonly streetCap?: number;
  readonly ranges?: readonly RangeAssumptionSummary[];
  readonly assumptionsContext?: DecisionAssumptionsContext;
}

export interface CallEvResult {
  readonly action: 'call';
  readonly ev: number;
  readonly expectedReturn: number;
  readonly potBeforeCall: number;
  readonly callAmount: number;
  readonly potAfterCall: number;
  readonly equity: number;
  readonly precision: 'exact';
  readonly assumptions: CalculationAssumptions;
}

export interface MultiPotEvSliceInput {
  readonly potId?: string;
  readonly label?: string;
  /** Chips already in this pot slice BEFORE hero puts in `heroAddedAmount`. */
  readonly potBeforeCall: number;
  /** Portion of hero's call that enters this pot slice (must be 0 if heroEligible is false). */
  readonly heroAddedAmount: number;
  /** Whether hero can win this pot slice. Ineligible pots contribute 0 to hero's EV. */
  readonly heroEligible: boolean;
  /** Hero's equity in [0, 1] against the eligible opponents for THIS pot slice. Required if heroEligible is true. */
  readonly heroEquity?: number;
}

export interface MultiPotCallEvInput {
  readonly callAmount: number;
  readonly pots: readonly MultiPotEvSliceInput[];
  readonly heroStack?: number;
  readonly heroStreetContribution?: number;
  readonly streetCap?: number;
  readonly ranges?: readonly RangeAssumptionSummary[];
  readonly assumptionsContext?: DecisionAssumptionsContext;
}

export interface MultiPotEvSliceBreakdown {
  readonly potId?: string;
  readonly label?: string;
  readonly potBeforeCall: number;
  readonly heroAddedAmount: number;
  readonly potAfterCall: number;
  readonly heroEligible: boolean;
  readonly heroEquity: number | null;
  readonly expectedReturn: number;
}

export interface MultiPotCallEvResult {
  readonly action: 'call';
  readonly ev: number;
  readonly totalExpectedReturn: number;
  readonly callAmount: number;
  readonly totalEligiblePotAfterCall: number;
  readonly excludedPotTotal: number;
  readonly slices: readonly MultiPotEvSliceBreakdown[];
  readonly precision: 'exact';
  readonly assumptions: CalculationAssumptions;
}

export interface CheckEvInput {
  readonly potBeforeAction: number;
  readonly equity: number;
  readonly currentBet?: number;
  readonly heroStreetContribution?: number;
  readonly ranges?: readonly RangeAssumptionSummary[];
  readonly assumptionsContext?: DecisionAssumptionsContext;
}

export interface CheckEvResult {
  readonly action: 'check';
  readonly ev: number;
  readonly potBeforeAction: number;
  readonly equity: number;
  readonly precision: 'estimated';
  readonly assumptions: CalculationAssumptions;
}

export interface ReraiseAssumption {
  /** Total street contribution the opponent reraises to (must satisfy Accate cap & step 5). */
  readonly reraiseTo: number;
  /** Additional chips the opponent puts in when reraising. */
  readonly opponentAddedOnReraise: number;
  readonly heroResponse: 'fold' | 'call';
  /** Required when heroResponse === 'call'. */
  readonly equityWhenReraised?: number;
}

export interface OpponentResponseAssumption {
  readonly foldProbability: number;
  readonly callProbability: number;
  readonly reraiseProbability?: number;
  /** Hero's equity in [0, 1] when opponent calls. Required when callProbability > 0. */
  readonly equityWhenCalled?: number;
  /** Total additional chips opponent(s) add to the pot when calling. Required when callProbability > 0. */
  readonly opponentAddedOnCall?: number;
  /** Required when reraiseProbability > 0. */
  readonly reraise?: ReraiseAssumption;
}

export interface BetOrRaiseEvInput {
  readonly action: 'bet' | 'raise';
  readonly street?: Street;
  readonly potBeforeAction: number;
  readonly currentBet: number;
  readonly heroStreetContribution: number;
  /** For 'bet': bet amount. For 'raise': total street contribution raised TO (`raiseTo`). */
  readonly targetBet: number;
  readonly heroStack: number;
  readonly streetCap?: number;
  readonly opponentResponse: OpponentResponseAssumption;
  readonly ranges?: readonly RangeAssumptionSummary[];
  readonly assumptionsContext?: DecisionAssumptionsContext;
}

export interface BetOrRaiseEvResult {
  readonly action: 'bet' | 'raise';
  readonly street: Street;
  readonly streetCap: number;
  readonly targetBet: number;
  readonly heroAddedAmount: number;
  readonly ev: number;
  readonly precision: 'estimated';
  readonly branches: {
    readonly foldProbability: number;
    readonly evWhenFolded: number;
    readonly callProbability: number;
    readonly evWhenCalled: number;
    readonly reraiseProbability: number;
    readonly evWhenReraised: number;
  };
  readonly assumptions: CalculationAssumptions;
}

const PROB_SUM_EPSILON = 1e-9;

function assertNonNegativeFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new CalculatorError(
      'invalid-ev-input',
      `${name} must be a finite non-negative number, received ${String(value)}`,
    );
  }
}

function assertProbability(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new CalculatorError(
      'invalid-ev-input',
      `${name} must be a finite number in [0, 1], received ${String(value)}`,
    );
  }
}

function validateStreetCap(street: Street, streetCap: number): void {
  if (
    !Number.isInteger(streetCap) ||
    streetCap < MIN_PREFLOP_CAP ||
    streetCap > MAX_PREFLOP_CAP ||
    streetCap % BET_STEP !== 0
  ) {
    throw new CalculatorError(
      'invalid-ev-input',
      `streetCap must be a multiple of ${BET_STEP} in [${MIN_PREFLOP_CAP}, ${MAX_PREFLOP_CAP}], received ${String(streetCap)}`,
    );
  }
  if (street !== 'preflop' && streetCap !== STREET_CAP) {
    throw new CalculatorError(
      'invalid-ev-input',
      `Postflop streetCap in Accate is fixed at ${STREET_CAP}, received ${String(streetCap)}`,
    );
  }
}

function buildEvAssumptions(params: {
  readonly method: 'exact-ev' | 'estimated-ev';
  readonly potBeforeAction?: number;
  readonly heroStack?: number;
  readonly streetCap?: number;
  readonly street?: Street;
  readonly ranges?: readonly RangeAssumptionSummary[];
  readonly assumptionsContext?: DecisionAssumptionsContext;
  readonly notes: readonly string[];
}): CalculationAssumptions {
  const ctx = params.assumptionsContext;
  const street = params.street ?? ctx?.street;
  const potBeforeAction = params.potBeforeAction ?? ctx?.potBeforeAction;
  const heroStack = params.heroStack ?? ctx?.heroStack;
  const streetCap = params.streetCap ?? ctx?.streetCap;
  const opponentCount = ctx?.opponentCount ?? params.ranges?.length;

  return Object.freeze({
    method: params.method,
    ...(street !== undefined ? { street } : {}),
    ...(opponentCount !== undefined ? { opponentCount } : {}),
    ...(params.ranges !== undefined ? { ranges: Object.freeze([...params.ranges]) } : {}),
    ...(potBeforeAction !== undefined ? { potBeforeAction } : {}),
    ...(heroStack !== undefined ? { heroStack } : {}),
    ...(streetCap !== undefined ? { streetCap } : {}),
    ...(ctx?.position !== undefined ? { position: ctx.position } : {}),
    notes: Object.freeze([...params.notes, ...(ctx?.notes ?? [])]),
  });
}

/**
 * EV of folding at decision time is always exactly 0 (chips already in pot are sunk costs).
 */
export function calculateFoldEv(
  assumptionsContext?: DecisionAssumptionsContext,
): FoldEvResult {
  return Object.freeze({
    action: 'fold',
    ev: 0,
    precision: 'exact',
    assumptions: buildEvAssumptions({
      method: 'exact-ev',
      assumptionsContext,
      notes: ['EV của Fold tại thời điểm quyết định luôn bằng 0 (chip đã bỏ vào pot trước đó là chi phí chìm).'],
    }),
  });
}

/**
 * Exact EV of calling a single eligible pot:
 * `EV(call) = equity * (potBeforeCall + callAmount) - callAmount`.
 */
export function calculateCallEv(input: CallEvInput): CallEvResult {
  const {
    potBeforeCall,
    callAmount,
    equity,
    heroStack,
    heroStreetContribution,
    streetCap,
    ranges,
    assumptionsContext,
  } = input;

  assertNonNegativeFinite(potBeforeCall, 'potBeforeCall');
  assertNonNegativeFinite(callAmount, 'callAmount');
  assertProbability(equity, 'equity');

  if (heroStack !== undefined) {
    assertNonNegativeFinite(heroStack, 'heroStack');
    if (callAmount > heroStack) {
      throw new CalculatorError(
        'invalid-ev-input',
        `callAmount (${callAmount}) exceeds heroStack (${heroStack})`,
      );
    }
  }
  if (streetCap !== undefined && heroStreetContribution !== undefined) {
    assertNonNegativeFinite(heroStreetContribution, 'heroStreetContribution');
    if (heroStreetContribution + callAmount > streetCap) {
      throw new CalculatorError(
        'exceeds-street-cap',
        `Call would bring hero street contribution (${heroStreetContribution + callAmount}) above streetCap (${streetCap})`,
      );
    }
  }

  const potAfterCall = potBeforeCall + callAmount;
  const expectedReturn = equity * potAfterCall;
  const ev = expectedReturn - callAmount;

  return Object.freeze({
    action: 'call',
    ev,
    expectedReturn,
    potBeforeCall,
    callAmount,
    potAfterCall,
    equity,
    precision: 'exact',
    assumptions: buildEvAssumptions({
      method: 'exact-ev',
      potBeforeAction: potBeforeCall,
      heroStack,
      streetCap,
      ranges,
      assumptionsContext,
      notes: [
        'EV Call chính xác với equity đã cho và phần pot hero có quyền tranh: equity × (potBeforeCall + callAmount) − callAmount.',
      ],
    }),
  });
}

/**
 * Exact EV of calling when main pot and side pots exist.
 * Uses each pot's caller-specified eligibility and per-pot equity, ensuring pots hero
 * is NOT eligible to win contribute 0 to hero's expected return.
 */
export function calculateMultiPotCallEv(input: MultiPotCallEvInput): MultiPotCallEvResult {
  const {
    callAmount,
    pots,
    heroStack,
    heroStreetContribution,
    streetCap,
    ranges,
    assumptionsContext,
  } = input;

  assertNonNegativeFinite(callAmount, 'callAmount');
  if (!Array.isArray(pots) || pots.length === 0) {
    throw new CalculatorError('invalid-ev-input', 'At least one pot slice is required');
  }

  if (heroStack !== undefined) {
    assertNonNegativeFinite(heroStack, 'heroStack');
    if (callAmount > heroStack) {
      throw new CalculatorError(
        'invalid-ev-input',
        `callAmount (${callAmount}) exceeds heroStack (${heroStack})`,
      );
    }
  }
  if (streetCap !== undefined && heroStreetContribution !== undefined) {
    assertNonNegativeFinite(heroStreetContribution, 'heroStreetContribution');
    if (heroStreetContribution + callAmount > streetCap) {
      throw new CalculatorError(
        'exceeds-street-cap',
        `Call would bring hero street contribution (${heroStreetContribution + callAmount}) above streetCap (${streetCap})`,
      );
    }
  }

  const slices: MultiPotEvSliceBreakdown[] = [];
  let sumHeroAdded = 0;
  let totalExpectedReturn = 0;
  let totalEligiblePotAfterCall = 0;
  let excludedPotTotal = 0;
  let totalPotBeforeCall = 0;

  for (let i = 0; i < pots.length; i++) {
    const slice = pots[i]!;
    assertNonNegativeFinite(slice.potBeforeCall, `pots[${i}].potBeforeCall`);
    assertNonNegativeFinite(slice.heroAddedAmount, `pots[${i}].heroAddedAmount`);

    totalPotBeforeCall += slice.potBeforeCall;
    sumHeroAdded += slice.heroAddedAmount;

    if (!slice.heroEligible) {
      if (slice.heroAddedAmount > 0) {
        throw new CalculatorError(
          'invalid-ev-input',
          `Hero cannot add chips (${slice.heroAddedAmount}) to an ineligible pot slice (index ${i})`,
        );
      }
      excludedPotTotal += slice.potBeforeCall;
      slices.push(
        Object.freeze({
          ...(slice.potId !== undefined ? { potId: slice.potId } : {}),
          ...(slice.label !== undefined ? { label: slice.label } : {}),
          potBeforeCall: slice.potBeforeCall,
          heroAddedAmount: 0,
          potAfterCall: slice.potBeforeCall,
          heroEligible: false,
          heroEquity: null,
          expectedReturn: 0,
        }),
      );
      continue;
    }

    if (slice.heroEquity === undefined) {
      throw new CalculatorError(
        'invalid-ev-input',
        `Eligible pot slice (index ${i}) must specify heroEquity in [0, 1]`,
      );
    }
    assertProbability(slice.heroEquity, `pots[${i}].heroEquity`);

    const potAfterCall = slice.potBeforeCall + slice.heroAddedAmount;
    const expectedReturn = slice.heroEquity * potAfterCall;
    totalEligiblePotAfterCall += potAfterCall;
    totalExpectedReturn += expectedReturn;

    slices.push(
      Object.freeze({
        ...(slice.potId !== undefined ? { potId: slice.potId } : {}),
        ...(slice.label !== undefined ? { label: slice.label } : {}),
        potBeforeCall: slice.potBeforeCall,
        heroAddedAmount: slice.heroAddedAmount,
        potAfterCall,
        heroEligible: true,
        heroEquity: slice.heroEquity,
        expectedReturn,
      }),
    );
  }

  if (Math.abs(sumHeroAdded - callAmount) > PROB_SUM_EPSILON) {
    throw new CalculatorError(
      'invalid-ev-input',
      `Sum of per-pot heroAddedAmount (${sumHeroAdded}) must equal callAmount (${callAmount})`,
    );
  }

  const ev = totalExpectedReturn - callAmount;

  return Object.freeze({
    action: 'call',
    ev,
    totalExpectedReturn,
    callAmount,
    totalEligiblePotAfterCall,
    excludedPotTotal,
    slices: Object.freeze(slices),
    precision: 'exact',
    assumptions: buildEvAssumptions({
      method: 'exact-ev',
      potBeforeAction: totalPotBeforeCall,
      heroStack,
      streetCap,
      ranges,
      assumptionsContext,
      notes: [
        'EV Call nhiều pot tính riêng theo equity và phần tiền đủ điều kiện của từng pot; loại hoàn toàn các side pot hero không đủ điều kiện tranh.',
      ],
    }),
  });
}

/**
 * Estimated EV of checking when facing no bet (`currentBet === heroStreetContribution`).
 * Assumes showdown equity realization without modeling future-street betting.
 */
export function calculateCheckEv(input: CheckEvInput): CheckEvResult {
  const {
    potBeforeAction,
    equity,
    currentBet = 0,
    heroStreetContribution = 0,
    ranges,
    assumptionsContext,
  } = input;

  assertNonNegativeFinite(potBeforeAction, 'potBeforeAction');
  assertProbability(equity, 'equity');
  assertNonNegativeFinite(currentBet, 'currentBet');
  assertNonNegativeFinite(heroStreetContribution, 'heroStreetContribution');

  if (currentBet > heroStreetContribution) {
    throw new CalculatorError(
      'invalid-ev-input',
      `Cannot check while facing a bet (currentBet=${currentBet}, heroStreetContribution=${heroStreetContribution})`,
    );
  }

  return Object.freeze({
    action: 'check',
    ev: equity * potBeforeAction,
    potBeforeAction,
    equity,
    precision: 'estimated',
    assumptions: buildEvAssumptions({
      method: 'estimated-ev',
      potBeforeAction,
      ranges,
      assumptionsContext,
      notes: [
        'Ước lượng EV Check = equity × potBeforeAction (giả định hiện thực hóa equity tới showdown, chưa mô phỏng cược ở các street sau).',
      ],
    }),
  });
}

/**
 * Estimated EV of a legal Accate bet or raise using caller-supplied opponent response assumptions
 * (fold / call / optional legal reraise).
 *
 * Strictly enforces Accate cap and step rules (multiple of 5, <= streetCap, cannot raise when
 * currentBet === streetCap, and cannot assume an opponent reraise above streetCap).
 */
export function calculateBetOrRaiseEv(input: BetOrRaiseEvInput): BetOrRaiseEvResult {
  const {
    action,
    street = input.assumptionsContext?.street ?? 'flop',
    potBeforeAction,
    currentBet,
    heroStreetContribution,
    targetBet,
    heroStack,
    streetCap = STREET_CAP,
    opponentResponse,
    ranges,
    assumptionsContext,
  } = input;

  assertNonNegativeFinite(potBeforeAction, 'potBeforeAction');
  assertNonNegativeFinite(heroStack, 'heroStack');
  validateStreetCap(street, streetCap);

  if (!Number.isInteger(currentBet) || currentBet < 0 || currentBet % BET_STEP !== 0 || currentBet > streetCap) {
    throw new CalculatorError(
      'invalid-ev-input',
      `currentBet must be a multiple of ${BET_STEP} in [0, ${streetCap}], received ${String(currentBet)}`,
    );
  }
  if (
    !Number.isInteger(heroStreetContribution) ||
    heroStreetContribution < 0 ||
    heroStreetContribution % BET_STEP !== 0 ||
    heroStreetContribution > currentBet
  ) {
    throw new CalculatorError(
      'invalid-ev-input',
      `heroStreetContribution must be a multiple of ${BET_STEP} in [0, ${currentBet}], received ${String(heroStreetContribution)}`,
    );
  }

  if (action === 'bet') {
    if (currentBet > 0) {
      throw new CalculatorError(
        'invalid-bet-amount',
        `Cannot bet when currentBet is already ${currentBet}; use raise instead`,
      );
    }
    if (!Number.isInteger(targetBet) || targetBet < BET_STEP || targetBet % BET_STEP !== 0) {
      throw new CalculatorError(
        'invalid-bet-amount',
        `Bet amount must be a multiple of ${BET_STEP} >= ${BET_STEP}, received ${String(targetBet)}`,
      );
    }
    if (targetBet > streetCap) {
      throw new CalculatorError(
        'exceeds-street-cap',
        `Bet amount (${targetBet}) exceeds Accate street cap (${streetCap})`,
      );
    }
  } else {
    if (currentBet === 0) {
      throw new CalculatorError(
        'invalid-bet-amount',
        'Cannot raise when currentBet is 0; use bet instead',
      );
    }
    if (currentBet >= streetCap) {
      throw new CalculatorError(
        'cap-reached',
        `Cannot raise because street cap (${streetCap}) has already been reached`,
      );
    }
    if (!Number.isInteger(targetBet) || targetBet % BET_STEP !== 0 || targetBet < currentBet + BET_STEP) {
      throw new CalculatorError(
        'invalid-bet-amount',
        `raiseTo must be a multiple of ${BET_STEP} >= ${currentBet + BET_STEP}, received ${String(targetBet)}`,
      );
    }
    if (targetBet > streetCap) {
      throw new CalculatorError(
        'exceeds-street-cap',
        `raiseTo (${targetBet}) exceeds Accate street cap (${streetCap})`,
      );
    }
  }

  const heroAddedAmount = targetBet - heroStreetContribution;
  if (heroAddedAmount > heroStack) {
    throw new CalculatorError(
      'invalid-ev-input',
      `Action requires ${heroAddedAmount} chips, which exceeds heroStack (${heroStack})`,
    );
  }

  const foldProbability = opponentResponse.foldProbability;
  const callProbability = opponentResponse.callProbability;
  const reraiseProbability = opponentResponse.reraiseProbability ?? 0;

  assertProbability(foldProbability, 'opponentResponse.foldProbability');
  assertProbability(callProbability, 'opponentResponse.callProbability');
  assertProbability(reraiseProbability, 'opponentResponse.reraiseProbability');

  const probSum = foldProbability + callProbability + reraiseProbability;
  if (Math.abs(probSum - 1) > PROB_SUM_EPSILON) {
    throw new CalculatorError(
      'invalid-ev-input',
      `Opponent response probabilities must sum to 1 (got ${probSum})`,
    );
  }

  const evWhenFolded = potBeforeAction;

  let evWhenCalled = 0;
  if (callProbability > 0) {
    if (opponentResponse.equityWhenCalled === undefined) {
      throw new CalculatorError(
        'invalid-ev-input',
        'equityWhenCalled is required when callProbability > 0',
      );
    }
    if (opponentResponse.opponentAddedOnCall === undefined) {
      throw new CalculatorError(
        'invalid-ev-input',
        'opponentAddedOnCall is required when callProbability > 0',
      );
    }
    assertProbability(opponentResponse.equityWhenCalled, 'opponentResponse.equityWhenCalled');
    assertNonNegativeFinite(opponentResponse.opponentAddedOnCall, 'opponentResponse.opponentAddedOnCall');

    const potWhenCalled = potBeforeAction + heroAddedAmount + opponentResponse.opponentAddedOnCall;
    evWhenCalled = opponentResponse.equityWhenCalled * potWhenCalled - heroAddedAmount;
  }

  let evWhenReraised = 0;
  if (reraiseProbability > 0) {
    if (targetBet >= streetCap) {
      throw new CalculatorError(
        'cap-reached',
        `Opponent cannot reraise because targetBet (${targetBet}) already reaches streetCap (${streetCap})`,
      );
    }
    const reraise = opponentResponse.reraise;
    if (reraise === undefined) {
      throw new CalculatorError(
        'invalid-ev-input',
        'reraise assumption details are required when reraiseProbability > 0',
      );
    }
    if (
      !Number.isInteger(reraise.reraiseTo) ||
      reraise.reraiseTo % BET_STEP !== 0 ||
      reraise.reraiseTo < targetBet + BET_STEP
    ) {
      throw new CalculatorError(
        'invalid-bet-amount',
        `Opponent reraiseTo must be a multiple of ${BET_STEP} >= ${targetBet + BET_STEP}, received ${String(reraise.reraiseTo)}`,
      );
    }
    if (reraise.reraiseTo > streetCap) {
      throw new CalculatorError(
        'exceeds-street-cap',
        `Opponent reraiseTo (${reraise.reraiseTo}) exceeds Accate street cap (${streetCap})`,
      );
    }
    assertNonNegativeFinite(reraise.opponentAddedOnReraise, 'reraise.opponentAddedOnReraise');

    if (reraise.heroResponse === 'fold') {
      evWhenReraised = -heroAddedAmount;
    } else {
      if (reraise.equityWhenReraised === undefined) {
        throw new CalculatorError(
          'invalid-ev-input',
          'equityWhenReraised is required when heroResponse === "call"',
        );
      }
      assertProbability(reraise.equityWhenReraised, 'reraise.equityWhenReraised');
      const heroExtraCall = Math.min(reraise.reraiseTo - targetBet, heroStack - heroAddedAmount);
      const totalHeroInvested = heroAddedAmount + heroExtraCall;
      const potWhenReraised =
        potBeforeAction + totalHeroInvested + reraise.opponentAddedOnReraise;
      evWhenReraised = reraise.equityWhenReraised * potWhenReraised - totalHeroInvested;
    }
  }

  const ev =
    foldProbability * evWhenFolded +
    callProbability * evWhenCalled +
    reraiseProbability * evWhenReraised;

  return Object.freeze({
    action,
    street,
    streetCap,
    targetBet,
    heroAddedAmount,
    ev,
    precision: 'estimated',
    branches: Object.freeze({
      foldProbability,
      evWhenFolded,
      callProbability,
      evWhenCalled,
      reraiseProbability,
      evWhenReraised,
    }),
    assumptions: buildEvAssumptions({
      method: 'estimated-ev',
      street,
      potBeforeAction,
      heroStack,
      streetCap,
      ranges,
      assumptionsContext,
      notes: [
        `Ước lượng EV ${action === 'bet' ? 'Bet' : 'Raise'} theo giả định phản ứng đối thủ do caller cung cấp (fold ${(foldProbability * 100).toFixed(1)}%, call ${(callProbability * 100).toFixed(1)}%, reraise ${(reraiseProbability * 100).toFixed(1)}%), tuân thủ cap street = ${streetCap}.`,
      ],
    }),
  });
}
