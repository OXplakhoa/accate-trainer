import type { Card } from '../cards';
import { compareHands, evaluateHand } from '../handEval';
import type { Street } from '../handTypes';
import type { Rng } from '../rng';
import {
  buildUniqueCardMask,
  cardToIndex,
  getRemainingDeck,
  normalizeOpponentRange,
  type CanonicalComboEntry,
  type NormalizedOpponentRange,
} from './ranges';
import {
  CalculatorError,
  type CalculationAssumptions,
  type DecisionAssumptionsContext,
  type DuplicateComboPolicy,
  type OpponentRangeInput,
} from './types';

const DEFAULT_SAMPLES = 5_000;
const DEFAULT_EXACT_MAX_EVALUATIONS = 200_000;
const FEASIBILITY_CHECK_STREAK = 64;
const FEASIBILITY_DFS_NODE_LIMIT = 10_000;

export type EquityStopReason = 'target-reached' | 'max-attempts-reached' | 'exact-complete';

export interface SimulateEquityInput {
  readonly heroCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly opponentRanges: readonly OpponentRangeInput[];
  readonly rng: Rng;
  readonly samples?: number;
  /** Finite work budget on sampling attempts (including rejected card-collision attempts). */
  readonly maxAttempts?: number;
  readonly deadCards?: readonly Card[];
  readonly duplicatePolicy?: DuplicateComboPolicy;
  readonly assumptionsContext?: DecisionAssumptionsContext;
}

export interface CalculateExactEquityInput {
  readonly heroCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly opponentRanges: readonly OpponentRangeInput[];
  readonly deadCards?: readonly Card[];
  readonly duplicatePolicy?: DuplicateComboPolicy;
  readonly maxEvaluations?: number;
  readonly assumptionsContext?: DecisionAssumptionsContext;
}

export interface EquityResult {
  readonly street: Street;
  readonly opponentCount: number;
  /** Hero's total equity in [0, 1]: winRate + tieEquityShare. */
  readonly equity: number;
  /** Fraction of trials/weight where hero strictly beats all opponents. */
  readonly winRate: number;
  /** Fraction of trials/weight where hero ties for best hand with >= 1 opponent. */
  readonly tieRate: number;
  /** Hero's average equity share coming from ties (sum of 1/(1+m) shares). */
  readonly tieEquityShare: number;
  /** Fraction of trials/weight where at least one opponent strictly beats hero. */
  readonly loseRate: number;
  readonly requestedSamples: number | null;
  readonly completedSamples: number;
  readonly attempts: number;
  readonly rejectedAttempts: number;
  readonly reachedTargetSamples: boolean;
  readonly stopReason: EquityStopReason;
  readonly warning: string | null;
  readonly assumptions: CalculationAssumptions;
}

function resolveStreetFromBoard(boardLength: number): Street {
  if (boardLength === 0) return 'preflop';
  if (boardLength === 3) return 'flop';
  if (boardLength === 4) return 'turn';
  if (boardLength === 5) return 'river';
  throw new CalculatorError(
    'invalid-board-length',
    `Board must contain 0 (preflop), 3 (flop), 4 (turn), or 5 (river) cards; received ${boardLength}`,
  );
}

function validateAndPrepareEquityInputs(input: {
  readonly heroCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly opponentRanges: readonly OpponentRangeInput[];
  readonly deadCards?: readonly Card[];
  readonly duplicatePolicy?: DuplicateComboPolicy;
}): {
  readonly street: Street;
  readonly missingBoardCount: number;
  readonly baseRemainingDeck: readonly Card[];
  readonly baseRemainingIndices: readonly number[];
  readonly normalizedRanges: readonly NormalizedOpponentRange[];
} {
  const { heroCards, board, opponentRanges, deadCards = [], duplicatePolicy } = input;

  if (!Array.isArray(heroCards) || heroCards.length !== 2) {
    throw new CalculatorError('invalid-combo', 'heroCards must contain exactly 2 cards');
  }
  if (!Array.isArray(opponentRanges) || opponentRanges.length === 0) {
    throw new CalculatorError('empty-range', 'At least one opponent range is required');
  }

  const seenOppIds = new Set<string>();
  for (const opp of opponentRanges) {
    if (seenOppIds.has(opp.opponentId)) {
      throw new CalculatorError(
        'invalid-equity-input',
        `Duplicate opponentId "${opp.opponentId}" in opponentRanges`,
      );
    }
    seenOppIds.add(opp.opponentId);
  }

  const street = resolveStreetFromBoard(board.length);
  const missingBoardCount = 5 - board.length;
  const knownCards = [...heroCards, ...board, ...deadCards];
  const { mask: knownMask } = buildUniqueCardMask(knownCards, 'hero, board, and dead cards');

  const baseRemainingDeck = getRemainingDeck(knownMask);
  const cardsNeededForOpponentsAndBoard = opponentRanges.length * 2 + missingBoardCount;
  if (baseRemainingDeck.length < cardsNeededForOpponentsAndBoard) {
    throw new CalculatorError(
      'insufficient-deck-cards',
      `Not enough remaining deck cards (${baseRemainingDeck.length}) for ${opponentRanges.length} opponent(s) and ${missingBoardCount} remaining board card(s)`,
    );
  }

  const normalizedRanges = opponentRanges.map((range) =>
    normalizeOpponentRange(range, knownCards, { duplicatePolicy }),
  );
  const baseRemainingIndices = baseRemainingDeck.map(cardToIndex);

  return {
    street,
    missingBoardCount,
    baseRemainingDeck,
    baseRemainingIndices,
    normalizedRanges,
  };
}

function buildCumulativeWeights(combos: readonly CanonicalComboEntry[]): {
  readonly cdf: readonly number[];
  readonly totalWeight: number;
} {
  const cdf: number[] = new Array(combos.length);
  let sum = 0;
  for (let i = 0; i < combos.length; i++) {
    sum += combos[i]!.weight;
    cdf[i] = sum;
  }
  return { cdf, totalWeight: sum };
}

function sampleFromCdf(cdf: readonly number[], totalWeight: number, u: number): number {
  const target = u * totalWeight;
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cdf[mid]! <= target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Bounded DFS backtracking check to determine whether at least one pairwise-disjoint
 * combo tuple exists across all opponents. Orders opponents by smallest range first
 * so impossible multiway constraints fail fast.
 */
function checkJointFeasibility(
  ranges: readonly NormalizedOpponentRange[],
  maxNodes: number,
): 'feasible' | 'impossible' | 'unknown' {
  const ordered = [...ranges].sort((a, b) => a.combos.length - b.combos.length);
  let nodesVisited = 0;
  let budgetHit = false;

  const dfs = (depth: number, usedLo: number, usedHi: number): boolean => {
    if (depth === ordered.length) {
      return true;
    }
    if (nodesVisited >= maxNodes) {
      budgetHit = true;
      return false;
    }
    nodesVisited++;

    const combos = ordered[depth]!.combos;
    for (let i = 0; i < combos.length; i++) {
      const combo = combos[i]!;
      if ((usedLo & combo.maskLo) !== 0 || (usedHi & combo.maskHi) !== 0) {
        continue;
      }
      if (dfs(depth + 1, usedLo | combo.maskLo, usedHi | combo.maskHi)) {
        return true;
      }
      if (budgetHit) {
        return false;
      }
    }
    return false;
  };

  if (dfs(0, 0, 0)) {
    return 'feasible';
  }
  return budgetHit ? 'unknown' : 'impossible';
}

function evaluateShowdownOutcome(
  heroCards: readonly [Card, Card],
  opponentCombos: readonly CanonicalComboEntry[],
  fullBoard: readonly Card[],
): { readonly outcome: 'win' | 'tie' | 'lose'; readonly equityShare: number } {
  const heroHand = evaluateHand([
    heroCards[0],
    heroCards[1],
    fullBoard[0]!,
    fullBoard[1]!,
    fullBoard[2]!,
    fullBoard[3]!,
    fullBoard[4]!,
  ]);

  let tiedOpponents = 0;
  for (let i = 0; i < opponentCombos.length; i++) {
    const oppCards = opponentCombos[i]!.cards;
    const oppHand = evaluateHand([
      oppCards[0],
      oppCards[1],
      fullBoard[0]!,
      fullBoard[1]!,
      fullBoard[2]!,
      fullBoard[3]!,
      fullBoard[4]!,
    ]);
    const cmp = compareHands(heroHand, oppHand);
    if (cmp < 0) {
      return { outcome: 'lose', equityShare: 0 };
    }
    if (cmp === 0) {
      tiedOpponents++;
    }
  }

  if (tiedOpponents === 0) {
    return { outcome: 'win', equityShare: 1 };
  }
  return { outcome: 'tie', equityShare: 1 / (1 + tiedOpponents) };
}

/**
 * Estimates hero's showdown equity via deterministic Monte Carlo simulation using `Rng`.
 *
 * - Supports preflop, flop, turn, river, and 1..N opponents.
 * - Samples opponent combos from the EXACT conditional product-weight distribution
 *   `P(c_1, ..., c_k) ∝ Π w_i(c_i)` over pairwise card-disjoint combos via independent
 *   rejection sampling (never distorts joint weights based on seat order).
 * - Samples missing board cards uniformly without replacement from the remaining deck.
 * - Splits tie equity equally by number of tied winners (`1 / (1 + tiedOpponents)`).
 * - Enforces a finite work budget (`maxAttempts`), detects provably impossible range
 *   combinations quickly, and explicitly reports when `completedSamples < requestedSamples`.
 */
export function simulateEquity(input: SimulateEquityInput): EquityResult {
  const {
    heroCards,
    board,
    opponentRanges,
    rng,
    samples = DEFAULT_SAMPLES,
    deadCards,
    duplicatePolicy,
    assumptionsContext,
  } = input;

  if (!Number.isInteger(samples) || samples < 1) {
    throw new CalculatorError(
      'invalid-sample-config',
      `samples must be a positive integer, received ${String(samples)}`,
    );
  }

  const maxAttempts = input.maxAttempts ?? Math.max(samples * 50, 10_000);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new CalculatorError(
      'invalid-sample-config',
      `maxAttempts must be a positive integer, received ${String(maxAttempts)}`,
    );
  }

  const {
    street,
    missingBoardCount,
    baseRemainingDeck,
    baseRemainingIndices,
    normalizedRanges,
  } = validateAndPrepareEquityInputs({
    heroCards,
    board,
    opponentRanges,
    deadCards,
    duplicatePolicy,
  });

  const k = normalizedRanges.length;
  const cdfs = normalizedRanges.map((r) => buildCumulativeWeights(r.combos));
  const comboRng = rng.fork('calculator:equity:combos');
  const boardRng = rng.fork('calculator:equity:board');

  const chosenCombos: CanonicalComboEntry[] = new Array(k);
  const availableBoardPool: Card[] = [];
  const fullBoard: Card[] = new Array(5);
  for (let i = 0; i < board.length; i++) {
    fullBoard[i] = board[i]!;
  }

  let attempts = 0;
  let rejectedAttempts = 0;
  let consecutiveRejections = 0;
  let completedSamples = 0;
  let feasibilityVerified = k === 1;

  let winCount = 0;
  let tieCount = 0;
  let loseCount = 0;
  let tieEquitySum = 0;
  let equitySum = 0;

  while (completedSamples < samples && attempts < maxAttempts) {
    attempts++;

    let usedLo = 0;
    let usedHi = 0;
    let collision = false;

    for (let i = 0; i < k; i++) {
      const { cdf, totalWeight } = cdfs[i]!;
      const idx = sampleFromCdf(cdf, totalWeight, comboRng.next());
      const combo = normalizedRanges[i]!.combos[idx]!;
      if ((usedLo & combo.maskLo) !== 0 || (usedHi & combo.maskHi) !== 0) {
        collision = true;
        break;
      }
      usedLo |= combo.maskLo;
      usedHi |= combo.maskHi;
      chosenCombos[i] = combo;
    }

    if (collision) {
      rejectedAttempts++;
      consecutiveRejections++;
      if (!feasibilityVerified && consecutiveRejections >= FEASIBILITY_CHECK_STREAK) {
        const status = checkJointFeasibility(normalizedRanges, FEASIBILITY_DFS_NODE_LIMIT);
        if (status === 'impossible') {
          throw new CalculatorError(
            'impossible-range-combination',
            'No pairwise card-disjoint combination exists across the provided opponent ranges',
          );
        }
        if (status === 'feasible') {
          feasibilityVerified = true;
        }
      }
      continue;
    }

    consecutiveRejections = 0;
    feasibilityVerified = true;

    if (missingBoardCount > 0) {
      availableBoardPool.length = 0;
      for (let i = 0; i < baseRemainingDeck.length; i++) {
        const cardIdx = baseRemainingIndices[i]!;
        const blocked =
          cardIdx < 26
            ? (usedLo & (1 << cardIdx)) !== 0
            : (usedHi & (1 << (cardIdx - 26))) !== 0;
        if (!blocked) {
          availableBoardPool.push(baseRemainingDeck[i]!);
        }
      }

      // Partial Fisher-Yates without replacement for missing board cards.
      for (let draw = 0; draw < missingBoardCount; draw++) {
        const remaining = availableBoardPool.length - draw;
        const pickOffset = boardRng.int(remaining);
        const swapIdx = draw + pickOffset;
        const picked = availableBoardPool[swapIdx]!;
        availableBoardPool[swapIdx] = availableBoardPool[draw]!;
        availableBoardPool[draw] = picked;
        fullBoard[board.length + draw] = picked;
      }
    }

    const { outcome, equityShare } = evaluateShowdownOutcome(heroCards, chosenCombos, fullBoard);
    if (outcome === 'win') {
      winCount++;
      equitySum += 1;
    } else if (outcome === 'tie') {
      tieCount++;
      tieEquitySum += equityShare;
      equitySum += equityShare;
    } else {
      loseCount++;
    }
    completedSamples++;
  }

  if (completedSamples === 0) {
    if (!feasibilityVerified) {
      const status = checkJointFeasibility(normalizedRanges, FEASIBILITY_DFS_NODE_LIMIT);
      if (status === 'impossible') {
        throw new CalculatorError(
          'impossible-range-combination',
          'No pairwise card-disjoint combination exists across the provided opponent ranges',
        );
      }
    }
    throw new CalculatorError(
      'max-attempts-exceeded-no-samples',
      `Reached maxAttempts (${maxAttempts}) without collecting any valid disjoint sample`,
    );
  }

  const reachedTargetSamples = completedSamples === samples;
  const stopReason: EquityStopReason = reachedTargetSamples
    ? 'target-reached'
    : 'max-attempts-reached';
  const warning = reachedTargetSamples
    ? null
    : `Không đạt đủ số mẫu yêu cầu (${completedSamples}/${samples}) sau ${attempts} lần thử do giới hạn công việc tối đa.`;

  const notes: string[] = [
    'Mô phỏng Monte Carlo theo phân phối tích trọng số có điều kiện (rejection sampling độc lập, không lệ thuộc thứ tự ghế).',
    'Equity chia hòa theo phần (1 / số người cùng mạnh nhất).',
    ...(warning !== null ? [warning] : []),
    ...(assumptionsContext?.notes ?? []),
  ];

  const assumptions: CalculationAssumptions = Object.freeze({
    method: 'monte-carlo',
    street: assumptionsContext?.street ?? street,
    opponentCount: k,
    ranges: Object.freeze(normalizedRanges.map((r) => r.summary)),
    ...(assumptionsContext?.potBeforeAction !== undefined
      ? { potBeforeAction: assumptionsContext.potBeforeAction }
      : {}),
    ...(assumptionsContext?.heroStack !== undefined
      ? { heroStack: assumptionsContext.heroStack }
      : {}),
    ...(assumptionsContext?.streetCap !== undefined
      ? { streetCap: assumptionsContext.streetCap }
      : {}),
    ...(assumptionsContext?.position !== undefined
      ? { position: assumptionsContext.position }
      : {}),
    samples: Object.freeze({
      requested: samples,
      completed: completedSamples,
      attempts,
      rejectedAttempts,
      reachedTarget: reachedTargetSamples,
      seed: rng.seed,
    }),
    notes: Object.freeze(notes),
  });

  return Object.freeze({
    street,
    opponentCount: k,
    equity: equitySum / completedSamples,
    winRate: winCount / completedSamples,
    tieRate: tieCount / completedSamples,
    tieEquityShare: tieEquitySum / completedSamples,
    loseRate: loseCount / completedSamples,
    requestedSamples: samples,
    completedSamples,
    attempts,
    rejectedAttempts,
    reachedTargetSamples,
    stopReason,
    warning,
    assumptions,
  });
}

/**
 * Computes exact showdown equity by enumerating all pairwise card-disjoint opponent combo
 * tuples (weighted by the product of their weights) and all remaining board runouts.
 * Guarded by `maxEvaluations` so large state spaces fail cleanly instead of hanging.
 */
export function calculateExactEquity(input: CalculateExactEquityInput): EquityResult {
  const {
    heroCards,
    board,
    opponentRanges,
    deadCards,
    duplicatePolicy,
    maxEvaluations = DEFAULT_EXACT_MAX_EVALUATIONS,
    assumptionsContext,
  } = input;

  if (!Number.isInteger(maxEvaluations) || maxEvaluations < 1) {
    throw new CalculatorError(
      'invalid-sample-config',
      `maxEvaluations must be a positive integer, received ${String(maxEvaluations)}`,
    );
  }

  const {
    street,
    missingBoardCount,
    baseRemainingDeck,
    baseRemainingIndices,
    normalizedRanges,
  } = validateAndPrepareEquityInputs({
    heroCards,
    board,
    opponentRanges,
    deadCards,
    duplicatePolicy,
  });

  const k = normalizedRanges.length;
  const chosenCombos: CanonicalComboEntry[] = new Array(k);
  const fullBoard: Card[] = new Array(5);
  for (let i = 0; i < board.length; i++) {
    fullBoard[i] = board[i]!;
  }

  let evaluations = 0;
  let validTupleCount = 0;
  let totalWeight = 0;
  let winWeight = 0;
  let tieWeight = 0;
  let tieEquityWeight = 0;
  let loseWeight = 0;

  const enumerateBoardRunouts = (
    available: readonly Card[],
    startIdx: number,
    drawn: number,
    tupleWeight: number,
  ): void => {
    if (drawn === missingBoardCount) {
      evaluations++;
      if (evaluations > maxEvaluations) {
        throw new CalculatorError(
          'exact-enumeration-limit-exceeded',
          `Exact enumeration exceeded maxEvaluations (${maxEvaluations}); use simulateEquity for large state spaces`,
        );
      }
      const { outcome, equityShare } = evaluateShowdownOutcome(heroCards, chosenCombos, fullBoard);
      totalWeight += tupleWeight;
      if (outcome === 'win') {
        winWeight += tupleWeight;
      } else if (outcome === 'tie') {
        tieWeight += tupleWeight;
        tieEquityWeight += tupleWeight * equityShare;
      } else {
        loseWeight += tupleWeight;
      }
      return;
    }

    const remainingNeeded = missingBoardCount - drawn;
    for (let i = startIdx; i <= available.length - remainingNeeded; i++) {
      fullBoard[board.length + drawn] = available[i]!;
      enumerateBoardRunouts(available, i + 1, drawn + 1, tupleWeight);
    }
  };

  const enumerateTuples = (
    depth: number,
    usedLo: number,
    usedHi: number,
    productWeight: number,
  ): void => {
    if (depth === k) {
      validTupleCount++;
      if (missingBoardCount === 0) {
        enumerateBoardRunouts([], 0, 0, productWeight);
        return;
      }
      const available: Card[] = [];
      for (let i = 0; i < baseRemainingDeck.length; i++) {
        const cardIdx = baseRemainingIndices[i]!;
        const blocked =
          cardIdx < 26
            ? (usedLo & (1 << cardIdx)) !== 0
            : (usedHi & (1 << (cardIdx - 26))) !== 0;
        if (!blocked) {
          available.push(baseRemainingDeck[i]!);
        }
      }
      enumerateBoardRunouts(available, 0, 0, productWeight);
      return;
    }

    const combos = normalizedRanges[depth]!.combos;
    for (let i = 0; i < combos.length; i++) {
      const combo = combos[i]!;
      if ((usedLo & combo.maskLo) !== 0 || (usedHi & combo.maskHi) !== 0) {
        continue;
      }
      chosenCombos[depth] = combo;
      enumerateTuples(
        depth + 1,
        usedLo | combo.maskLo,
        usedHi | combo.maskHi,
        productWeight * combo.weight,
      );
    }
  };

  enumerateTuples(0, 0, 0, 1);

  if (validTupleCount === 0 || totalWeight === 0) {
    throw new CalculatorError(
      'impossible-range-combination',
      'No pairwise card-disjoint combination exists across the provided opponent ranges',
    );
  }

  const notes: string[] = [
    'Liệt kê chính xác mọi tổ hợp combo rời nhau (tích trọng số) và mọi lá board còn lại.',
    'Equity chia hòa theo phần (1 / số người cùng mạnh nhất).',
    ...(assumptionsContext?.notes ?? []),
  ];

  const assumptions: CalculationAssumptions = Object.freeze({
    method: 'exact-enumeration',
    street: assumptionsContext?.street ?? street,
    opponentCount: k,
    ranges: Object.freeze(normalizedRanges.map((r) => r.summary)),
    ...(assumptionsContext?.potBeforeAction !== undefined
      ? { potBeforeAction: assumptionsContext.potBeforeAction }
      : {}),
    ...(assumptionsContext?.heroStack !== undefined
      ? { heroStack: assumptionsContext.heroStack }
      : {}),
    ...(assumptionsContext?.streetCap !== undefined
      ? { streetCap: assumptionsContext.streetCap }
      : {}),
    ...(assumptionsContext?.position !== undefined
      ? { position: assumptionsContext.position }
      : {}),
    exactEvaluations: evaluations,
    notes: Object.freeze(notes),
  });

  return Object.freeze({
    street,
    opponentCount: k,
    equity: (winWeight + tieEquityWeight) / totalWeight,
    winRate: winWeight / totalWeight,
    tieRate: tieWeight / totalWeight,
    tieEquityShare: tieEquityWeight / totalWeight,
    loseRate: loseWeight / totalWeight,
    requestedSamples: null,
    completedSamples: evaluations,
    attempts: evaluations,
    rejectedAttempts: 0,
    reachedTargetSamples: true,
    stopReason: 'exact-complete',
    warning: null,
    assumptions,
  });
}
