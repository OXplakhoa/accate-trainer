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
const DEFAULT_MAX_ATTEMPTS_MULTIPLIER = 50;
const DEFAULT_MIN_MAX_ATTEMPTS = 10_000;
const MAX_SAFE_SAMPLES_FOR_ATTEMPTS_SCALE = Math.floor(
  Number.MAX_SAFE_INTEGER / DEFAULT_MAX_ATTEMPTS_MULTIPLIER,
);
const DEFAULT_EXACT_MAX_EVALUATIONS = 200_000;
const DEFAULT_EXACT_MAX_SEARCH_STEPS = 250_000;
const EXACT_SEARCH_STEPS_PER_EVALUATION = 8;
const MAX_SAFE_EVALUATIONS_FOR_SEARCH_SCALE = Math.floor(
  Number.MAX_SAFE_INTEGER / EXACT_SEARCH_STEPS_PER_EVALUATION,
);
const FEASIBILITY_CHECK_STREAK = 64;
const DEFAULT_FEASIBILITY_MAX_STEPS = 50_000;

export type EquityStopReason = 'target-reached' | 'max-attempts-reached' | 'exact-complete';

export interface SimulateEquityInput {
  readonly heroCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly opponentRanges: readonly OpponentRangeInput[];
  readonly rng: Rng;
  readonly samples?: number;
  /** Finite work budget on sampling attempts (including rejected card-collision attempts). */
  readonly maxAttempts?: number;
  /** Optional explicit work budget on bounded DFS feasibility search steps. */
  readonly maxFeasibilitySteps?: number;
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
  /** Optional explicit work budget on partial-tuple exploration steps before showdown runouts. */
  readonly maxSearchSteps?: number;
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

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CalculatorError(
      'invalid-sample-config',
      `${name} must be a positive safe integer, received ${String(value)}`,
    );
  }
}

function popcount32(x: number): number {
  let v = x | 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

function popcountMask(lo: number, hi: number): number {
  return popcount32(lo) + popcount32(hi);
}

interface RangeMaskInfo {
  readonly range: NormalizedOpponentRange;
  readonly maskLo: number;
  readonly maskHi: number;
  readonly cardCount: number;
}

function buildRangeMaskInfos(
  ranges: readonly NormalizedOpponentRange[],
): readonly RangeMaskInfo[] {
  return ranges.map((range) => {
    let maskLo = 0;
    let maskHi = 0;
    for (let i = 0; i < range.combos.length; i++) {
      const combo = range.combos[i]!;
      maskLo |= combo.maskLo;
      maskHi |= combo.maskHi;
    }
    return {
      range,
      maskLo,
      maskHi,
      cardCount: popcountMask(maskLo, maskHi),
    };
  });
}

/**
 * Necessary Hall-type cardinality check: any subset of `m` opponents must be able
 * to draw `2 * m` distinct cards from the union of cards appearing in their ranges.
 * Rejects impossible card pools (e.g., 6 opponents restricted to a 10-card pool)
 * in O(totalCombos + k log k) before any backtracking search.
 */
function hasImpossibleCardCardinality(infos: readonly RangeMaskInfo[]): boolean {
  const k = infos.length;
  if (k <= 1) {
    return false;
  }

  let allLo = 0;
  let allHi = 0;
  for (let i = 0; i < k; i++) {
    allLo |= infos[i]!.maskLo;
    allHi |= infos[i]!.maskHi;
  }
  if (popcountMask(allLo, allHi) < 2 * k) {
    return true;
  }

  const byPool = [...infos].sort(
    (a, b) =>
      a.cardCount - b.cardCount ||
      a.maskHi - b.maskHi ||
      a.maskLo - b.maskLo ||
      a.range.combos.length - b.range.combos.length,
  );

  let prefixLo = 0;
  let prefixHi = 0;
  let sameMaskCount = 0;
  let prevLo = -1;
  let prevHi = -1;
  let prevCardCount = 0;

  for (let i = 0; i < k; i++) {
    const info = byPool[i]!;
    prefixLo |= info.maskLo;
    prefixHi |= info.maskHi;
    if (popcountMask(prefixLo, prefixHi) < 2 * (i + 1)) {
      return true;
    }

    if (info.maskLo === prevLo && info.maskHi === prevHi) {
      sameMaskCount++;
    } else {
      prevLo = info.maskLo;
      prevHi = info.maskHi;
      prevCardCount = info.cardCount;
      sameMaskCount = 1;
    }
    if (prevCardCount < 2 * sameMaskCount) {
      return true;
    }
  }

  return false;
}

function buildCumulativeWeights(combos: readonly CanonicalComboEntry[]): {
  readonly cdf: readonly number[];
  readonly totalWeight: number;
} {
  let maxWeight = 0;
  for (let i = 0; i < combos.length; i++) {
    const w = combos[i]!.weight;
    if (w > maxWeight) {
      maxWeight = w;
    }
  }
  if (!Number.isFinite(maxWeight) || maxWeight <= 0) {
    throw new CalculatorError(
      'invalid-weight',
      'Opponent range must contain at least one finite positive combo weight',
    );
  }

  // Normalize weights by maxWeight so every entry lies in (0, 1] and the CDF sum
  // lies in [1, combos.length], preventing subnormal underflow or cumulative overflow.
  const cdf: number[] = new Array(combos.length);
  let sum = 0;
  for (let i = 0; i < combos.length; i++) {
    sum += combos[i]!.weight / maxWeight;
    cdf[i] = sum;
  }
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new CalculatorError(
      'invalid-weight',
      'Opponent range cumulative weight is not representable as a finite positive number',
    );
  }
  return { cdf, totalWeight: sum };
}

function sampleFromCdf(cdf: readonly number[], totalWeight: number, u: number): number {
  const target = u * totalWeight;
  if (!Number.isFinite(target)) {
    throw new CalculatorError(
      'invalid-weight',
      'Sampling target weight is not finite',
    );
  }
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
 * combo tuple exists across all opponents. Combines Hall-type cardinality checks,
 * fail-first ordering, suffix card-union pruning, and failed-state memoization,
 * strictly bounded by `maxSteps`.
 */
function checkJointFeasibility(
  infos: readonly RangeMaskInfo[],
  maxSteps: number,
): 'feasible' | 'impossible' | 'unknown' {
  if (hasImpossibleCardCardinality(infos)) {
    return 'impossible';
  }

  const ordered = [...infos].sort(
    (a, b) => a.range.combos.length - b.range.combos.length || a.cardCount - b.cardCount,
  );
  const k = ordered.length;
  const suffixUnionLo = new Int32Array(k + 1);
  const suffixUnionHi = new Int32Array(k + 1);
  for (let i = k - 1; i >= 0; i--) {
    suffixUnionLo[i] = suffixUnionLo[i + 1]! | ordered[i]!.maskLo;
    suffixUnionHi[i] = suffixUnionHi[i + 1]! | ordered[i]!.maskHi;
  }

  let stepsVisited = 0;
  let budgetHit = false;
  const failedStates = new Set<string>();

  const dfs = (depth: number, usedLo: number, usedHi: number): boolean => {
    if (depth === k) {
      return true;
    }

    const remainingCards = popcountMask(
      suffixUnionLo[depth]! & ~usedLo,
      suffixUnionHi[depth]! & ~usedHi,
    );
    if (remainingCards < 2 * (k - depth)) {
      return false;
    }

    const stateKey = `${depth}:${usedLo}:${usedHi}`;
    if (failedStates.has(stateKey)) {
      return false;
    }

    if (stepsVisited >= maxSteps) {
      budgetHit = true;
      return false;
    }
    stepsVisited++;

    const combos = ordered[depth]!.range.combos;
    for (let i = 0; i < combos.length; i++) {
      if (stepsVisited >= maxSteps) {
        budgetHit = true;
        return false;
      }
      stepsVisited++;

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

    failedStates.add(stateKey);
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
    maxFeasibilitySteps = DEFAULT_FEASIBILITY_MAX_STEPS,
    deadCards,
    duplicatePolicy,
    assumptionsContext,
  } = input;

  assertPositiveSafeInteger(samples, 'samples');

  const maxAttempts =
    input.maxAttempts ??
    (samples > MAX_SAFE_SAMPLES_FOR_ATTEMPTS_SCALE
      ? Number.MAX_SAFE_INTEGER
      : Math.max(samples * DEFAULT_MAX_ATTEMPTS_MULTIPLIER, DEFAULT_MIN_MAX_ATTEMPTS));
  assertPositiveSafeInteger(maxAttempts, 'maxAttempts');
  assertPositiveSafeInteger(maxFeasibilitySteps, 'maxFeasibilitySteps');

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
  const rangeMaskInfos = buildRangeMaskInfos(normalizedRanges);
  if (hasImpossibleCardCardinality(rangeMaskInfos)) {
    throw new CalculatorError(
      'impossible-range-combination',
      'No pairwise card-disjoint combination exists across the provided opponent ranges',
    );
  }

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
  // Ensures the invariant feasibility DFS runs at most once even if it returns 'unknown'.
  let feasibilityChecked = k === 1;

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
      if (!feasibilityChecked && consecutiveRejections >= FEASIBILITY_CHECK_STREAK) {
        feasibilityChecked = true;
        const status = checkJointFeasibility(rangeMaskInfos, maxFeasibilitySteps);
        if (status === 'impossible') {
          throw new CalculatorError(
            'impossible-range-combination',
            'No pairwise card-disjoint combination exists across the provided opponent ranges',
          );
        }
      }
      continue;
    }

    consecutiveRejections = 0;
    feasibilityChecked = true;

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
    if (!feasibilityChecked) {
      feasibilityChecked = true;
      const status = checkJointFeasibility(rangeMaskInfos, maxFeasibilitySteps);
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
 *
 * - Uses per-range normalization + log-space streaming log-sum-exp conditioning so multiway
 *   product weights are strictly invariant under positive rescaling of any opponent range
 *   and never falsely underflow or overflow.
 * - Guarded by both `maxEvaluations` (completed runouts) and `maxSearchSteps` (partial-tuple
 *   exploration steps) so large or heavily conflicting state spaces fail cleanly without hanging.
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

  assertPositiveSafeInteger(maxEvaluations, 'maxEvaluations');

  const maxSearchSteps =
    input.maxSearchSteps ??
    (maxEvaluations > MAX_SAFE_EVALUATIONS_FOR_SEARCH_SCALE
      ? Number.MAX_SAFE_INTEGER
      : Math.max(
          maxEvaluations * EXACT_SEARCH_STEPS_PER_EVALUATION,
          DEFAULT_EXACT_MAX_SEARCH_STEPS,
        ));
  assertPositiveSafeInteger(maxSearchSteps, 'maxSearchSteps');

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
  const rangeMaskInfos = buildRangeMaskInfos(normalizedRanges);
  if (hasImpossibleCardCardinality(rangeMaskInfos)) {
    throw new CalculatorError(
      'impossible-range-combination',
      'No pairwise card-disjoint combination exists across the provided opponent ranges',
    );
  }

  // Fail-first opponent order for traversal (assumptions still preserve caller order).
  const orderedRanges = [...rangeMaskInfos]
    .sort((a, b) => a.range.combos.length - b.range.combos.length || a.cardCount - b.cardCount)
    .map((info) => {
      const combos = info.range.combos;
      let maxWeight = 0;
      for (let i = 0; i < combos.length; i++) {
        const w = combos[i]!.weight;
        if (w > maxWeight) {
          maxWeight = w;
        }
      }
      const logMaxWeight = Math.log(maxWeight);
      const logWeights = combos.map((combo) => {
        const ratio = combo.weight / maxWeight;
        return ratio > 0 ? Math.log(ratio) : Math.log(combo.weight) - logMaxWeight;
      });
      return {
        combos,
        logWeights,
        maskLo: info.maskLo,
        maskHi: info.maskHi,
      };
    });

  const suffixUnionLo = new Int32Array(k + 1);
  const suffixUnionHi = new Int32Array(k + 1);
  for (let i = k - 1; i >= 0; i--) {
    suffixUnionLo[i] = suffixUnionLo[i + 1]! | orderedRanges[i]!.maskLo;
    suffixUnionHi[i] = suffixUnionHi[i + 1]! | orderedRanges[i]!.maskHi;
  }

  const chosenCombos: CanonicalComboEntry[] = new Array(k);
  const fullBoard: Card[] = new Array(5);
  for (let i = 0; i < board.length; i++) {
    fullBoard[i] = board[i]!;
  }

  let evaluations = 0;
  let searchSteps = 0;
  let validTupleCount = 0;

  let maxLogWeight = Number.NEGATIVE_INFINITY;
  let totalScaledWeight = 0;
  let winScaledWeight = 0;
  let tieScaledWeight = 0;
  let tieEquityScaledWeight = 0;
  let loseScaledWeight = 0;

  let tupleRunouts = 0;
  let tupleWins = 0;
  let tupleTies = 0;
  let tupleTieEquity = 0;
  let tupleLoses = 0;

  const accumulateTupleRunouts = (logTupleWeight: number): void => {
    let weightScale: number;
    if (maxLogWeight === Number.NEGATIVE_INFINITY) {
      maxLogWeight = logTupleWeight;
      weightScale = 1;
    } else if (logTupleWeight > maxLogWeight) {
      const shift = Math.exp(maxLogWeight - logTupleWeight);
      totalScaledWeight *= shift;
      winScaledWeight *= shift;
      tieScaledWeight *= shift;
      tieEquityScaledWeight *= shift;
      loseScaledWeight *= shift;
      maxLogWeight = logTupleWeight;
      weightScale = 1;
    } else {
      weightScale = Math.exp(logTupleWeight - maxLogWeight);
    }

    totalScaledWeight += tupleRunouts * weightScale;
    winScaledWeight += tupleWins * weightScale;
    tieScaledWeight += tupleTies * weightScale;
    tieEquityScaledWeight += tupleTieEquity * weightScale;
    loseScaledWeight += tupleLoses * weightScale;
  };

  const enumerateBoardRunouts = (
    available: readonly Card[],
    startIdx: number,
    drawn: number,
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
      tupleRunouts++;
      if (outcome === 'win') {
        tupleWins++;
      } else if (outcome === 'tie') {
        tupleTies++;
        tupleTieEquity += equityShare;
      } else {
        tupleLoses++;
      }
      return;
    }

    const remainingNeeded = missingBoardCount - drawn;
    for (let i = startIdx; i <= available.length - remainingNeeded; i++) {
      fullBoard[board.length + drawn] = available[i]!;
      enumerateBoardRunouts(available, i + 1, drawn + 1);
    }
  };

  const enumerateTuples = (
    depth: number,
    usedLo: number,
    usedHi: number,
    logProductWeight: number,
  ): void => {
    if (depth === k) {
      validTupleCount++;
      tupleRunouts = 0;
      tupleWins = 0;
      tupleTies = 0;
      tupleTieEquity = 0;
      tupleLoses = 0;

      if (missingBoardCount === 0) {
        enumerateBoardRunouts([], 0, 0);
      } else {
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
        enumerateBoardRunouts(available, 0, 0);
      }

      accumulateTupleRunouts(logProductWeight);
      return;
    }

    const remainingCards = popcountMask(
      suffixUnionLo[depth]! & ~usedLo,
      suffixUnionHi[depth]! & ~usedHi,
    );
    if (remainingCards < 2 * (k - depth)) {
      return;
    }

    const { combos, logWeights } = orderedRanges[depth]!;
    for (let i = 0; i < combos.length; i++) {
      searchSteps++;
      if (searchSteps > maxSearchSteps) {
        throw new CalculatorError(
          'exact-enumeration-limit-exceeded',
          `Exact enumeration exceeded maxSearchSteps (${maxSearchSteps}) while exploring partial opponent tuples; use simulateEquity for large or high-conflict state spaces`,
        );
      }

      const combo = combos[i]!;
      if ((usedLo & combo.maskLo) !== 0 || (usedHi & combo.maskHi) !== 0) {
        continue;
      }
      chosenCombos[depth] = combo;
      enumerateTuples(
        depth + 1,
        usedLo | combo.maskLo,
        usedHi | combo.maskHi,
        logProductWeight + logWeights[i]!,
      );
    }
  };

  enumerateTuples(0, 0, 0, 0);

  if (validTupleCount === 0 || totalScaledWeight === 0) {
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
    equity: (winScaledWeight + tieEquityScaledWeight) / totalScaledWeight,
    winRate: winScaledWeight / totalScaledWeight,
    tieRate: tieScaledWeight / totalScaledWeight,
    tieEquityShare: tieEquityScaledWeight / totalScaledWeight,
    loseRate: loseScaledWeight / totalScaledWeight,
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
