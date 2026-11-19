import type { Card } from '../cards';
import { compareHands, evaluateHand, type HandCategory, type HandValue } from '../handEval';
import type { Street } from '../handTypes';
import {
  calculateDrawProbabilities,
  type DrawProbabilityReport,
} from './probabilities';
import {
  buildUniqueCardMask,
  cardMaskBit,
  cardToIndex,
  getRemainingDeck,
  normalizeOpponentRange,
} from './ranges';
import {
  CalculatorError,
  type CalculationAssumptions,
  type DecisionAssumptionsContext,
  type DuplicateComboPolicy,
  type OpponentRangeInput,
} from './types';

export type ImprovementKind = 'none' | 'kicker-or-rank' | 'category';

export interface ImprovementCandidateContext {
  readonly card: Card;
  readonly before: HandValue;
  readonly after: HandValue;
  readonly improvementKind: ImprovementKind;
  readonly heroCards: readonly [Card, Card];
  readonly boardBefore: readonly Card[];
  readonly boardAfter: readonly Card[];
}

export interface ImprovementTargetGroup {
  readonly id: string;
  readonly label: string;
  readonly predicate: (context: ImprovementCandidateContext) => boolean;
}

export interface ImprovementCardEntry {
  readonly card: Card;
  readonly before: HandValue;
  readonly after: HandValue;
  readonly improvementKind: ImprovementKind;
}

export interface TargetGroupImprovementSummary {
  readonly id: string;
  readonly label: string;
  readonly metricKind: 'improvement-probability';
  readonly cards: readonly Card[];
  readonly count: number;
  readonly probabilities: DrawProbabilityReport;
}

export interface HandImprovementAnalysis {
  readonly street: Exclude<Street, 'preflop'>;
  readonly currentHand: HandValue;
  readonly unseenCardCount: number;
  readonly cardsRemainingToRiver: 0 | 1 | 2;
  readonly candidates: readonly ImprovementCardEntry[];
  readonly improvingCards: readonly ImprovementCardEntry[];
  readonly categoryImprovingCards: readonly ImprovementCardEntry[];
  readonly kickerOrRankImprovingCards: readonly ImprovementCardEntry[];
  readonly targetGroups: readonly TargetGroupImprovementSummary[];
  readonly probabilities: {
    readonly anyImprovement: DrawProbabilityReport;
    readonly categoryImprovement: DrawProbabilityReport;
    readonly kickerOrRankImprovement: DrawProbabilityReport;
  };
  /** Explicitly separates hand-improvement probabilities from showdown win equity. */
  readonly metricKind: 'improvement-probability';
}

export interface AnalyzeHandImprovementsInput {
  readonly heroCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly deadCards?: readonly Card[];
  readonly targetGroups?: readonly ImprovementTargetGroup[];
}

export type RangeOutClassification =
  | 'clean-out'
  | 'mixed-out'
  | 'chop-out'
  | 'improvement-only'
  | 'non-out'
  | 'blocked-range';

export interface RangeOutCardDetail {
  readonly card: Card;
  readonly heroBefore: HandValue;
  readonly heroAfter: HandValue;
  readonly improvementKind: ImprovementKind;
  readonly classification: RangeOutClassification;
  readonly validOpponentComboCount: number;
  readonly validOpponentWeight: number;
  readonly winWeightBefore: number;
  readonly tieWeightBefore: number;
  readonly loseWeightBefore: number;
  readonly winWeightAfter: number;
  readonly tieWeightAfter: number;
  readonly loseWeightAfter: number;
  readonly flippedToWinWeight: number;
  readonly flippedFromLoseToTieWeight: number;
  readonly regressedWeight: number;
  readonly winningComboCountAfter: number;
  readonly tyingComboCountAfter: number;
  readonly losingComboCountAfter: number;
  /** Weighted win share vs valid combos after this card falls (0 when blocked-range). */
  readonly winShareAfter: number;
  /** Weighted tie share vs valid combos after this card falls (0 when blocked-range). */
  readonly tieShareAfter: number;
  /** Weighted lose share vs valid combos after this card falls (0 when blocked-range). */
  readonly loseShareAfter: number;
  /** Next-street showdown equity against valid combos after this card falls (0 when blocked-range). */
  readonly nextStreetEquityAfter: number;
  /** True when hero still loses to at least one valid combo in opponent's range after this card falls. */
  readonly stillLosesToSomeComboAfter: boolean;
}

export interface AnalyzeOutsAgainstRangeInput {
  readonly heroCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly opponentRange: OpponentRangeInput;
  readonly deadCards?: readonly Card[];
  readonly duplicatePolicy?: DuplicateComboPolicy;
  readonly assumptionsContext?: DecisionAssumptionsContext;
}

export interface RangeOutsAnalysis {
  readonly street: Exclude<Street, 'preflop'>;
  readonly currentHand: HandValue;
  readonly unseenCardCount: number;
  readonly cardsRemainingToRiver: 0 | 1 | 2;
  /** Weighted equity on the CURRENT street before the next card is dealt. */
  readonly currentStreetEquity: number;
  readonly perCard: readonly RangeOutCardDetail[];
  /** Cards flipping hero from trailing/tied to winning against 100% of valid opponent combos. */
  readonly cleanOuts: readonly RangeOutCardDetail[];
  /** Cards flipping at least one combo from trailing/tied to win, while still losing/tying some combo(s). */
  readonly mixedOuts: readonly RangeOutCardDetail[];
  /** Cards flipping at least one losing combo to a tie without flipping any to a win. */
  readonly chopOuts: readonly RangeOutCardDetail[];
  /** Cards that improve hero's hand rank/category without flipping any combo from trailing/tied to win. */
  readonly improvementOnlyCards: readonly RangeOutCardDetail[];
  readonly nonOutCards: readonly RangeOutCardDetail[];
  /** Cards that block every combo in the assumed opponent range. */
  readonly blockedCards: readonly RangeOutCardDetail[];
  readonly cleanOutProbabilities: DrawProbabilityReport;
  readonly cleanAndMixedOutProbabilities: DrawProbabilityReport;
  readonly assumptions: CalculationAssumptions;
}

function resolvePostflopStreet(boardLength: number): Exclude<Street, 'preflop'> {
  if (boardLength === 3) {
    return 'flop';
  }
  if (boardLength === 4) {
    return 'turn';
  }
  if (boardLength === 5) {
    return 'river';
  }
  throw new CalculatorError(
    'invalid-board-length',
    `Postflop outs analysis requires 3 (flop), 4 (turn), or 5 (river) board cards; received ${boardLength}`,
  );
}

function classifyImprovement(before: HandValue, after: HandValue): ImprovementKind {
  const cmp = compareHands(after, before);
  if (cmp <= 0) {
    return 'none';
  }
  return after.category !== before.category ? 'category' : 'kicker-or-rank';
}

/**
 * Convenience predicate factory for counting cards that make a set (three-of-a-kind)
 * with hero's pocket pair (e.g. H1 #7: Js Jd -> Jh, Jc).
 */
export function createPocketPairSetTargetGroup(
  heroCards: readonly [Card, Card],
  id = 'pocket-pair-set',
  label = 'Lên set từ đôi tay',
): ImprovementTargetGroup {
  const isPocketPair = heroCards[0].rank === heroCards[1].rank;
  const pairRank = heroCards[0].rank;
  return {
    id,
    label,
    predicate: (ctx) =>
      isPocketPair &&
      ctx.card.rank === pairRank &&
      ctx.before.category === 'pair' &&
      ctx.after.category === 'three-of-a-kind' &&
      ctx.after.ranks[0] === pairRank,
  };
}

/**
 * Convenience predicate factory for counting cards that improve hero into a target hand category.
 */
export function createCategoryTargetGroup(
  id: string,
  label: string,
  targetCategory: HandCategory,
): ImprovementTargetGroup {
  return {
    id,
    label,
    predicate: (ctx) =>
      ctx.improvementKind === 'category' && ctx.after.category === targetCategory,
  };
}

/**
 * Enumerates unseen candidate cards on flop/turn (or returns empty candidates on river)
 * using the Hold'em hand evaluator, separating hand category improvements from kicker/rank
 * improvements and evaluating any caller-specified improvement target groups.
 *
 * Probabilities returned here are strictly **hand-improvement probabilities**, NOT win equity.
 */
export function analyzeHandImprovements(
  input: AnalyzeHandImprovementsInput,
): HandImprovementAnalysis {
  const { heroCards, board, deadCards = [], targetGroups = [] } = input;
  if (!Array.isArray(heroCards) || heroCards.length !== 2) {
    throw new CalculatorError('invalid-combo', 'heroCards must contain exactly 2 cards');
  }

  const street = resolvePostflopStreet(board.length);
  const { mask: knownMask } = buildUniqueCardMask(
    [...heroCards, ...board, ...deadCards],
    'hero, board, and dead cards',
  );

  const currentHand = evaluateHand([...heroCards, ...board]);
  const remainingDeck = getRemainingDeck(knownMask);
  const unseenCardCount = remainingDeck.length;
  const cardsRemainingToRiver: 0 | 1 | 2 =
    street === 'flop' ? 2 : street === 'turn' ? 1 : 0;

  if (cardsRemainingToRiver === 0) {
    const emptyProb = calculateDrawProbabilities({ outs: 0, street: 'river', unseenCards: unseenCardCount });
    return Object.freeze({
      street,
      currentHand,
      unseenCardCount,
      cardsRemainingToRiver: 0,
      candidates: Object.freeze([]),
      improvingCards: Object.freeze([]),
      categoryImprovingCards: Object.freeze([]),
      kickerOrRankImprovingCards: Object.freeze([]),
      targetGroups: Object.freeze(
        targetGroups.map((group) =>
          Object.freeze({
            id: group.id,
            label: group.label,
            metricKind: 'improvement-probability' as const,
            cards: Object.freeze([]),
            count: 0,
            probabilities: emptyProb,
          }),
        ),
      ),
      probabilities: Object.freeze({
        anyImprovement: emptyProb,
        categoryImprovement: emptyProb,
        kickerOrRankImprovement: emptyProb,
      }),
      metricKind: 'improvement-probability' as const,
    });
  }

  const candidates: ImprovementCardEntry[] = [];
  const improvingCards: ImprovementCardEntry[] = [];
  const categoryImprovingCards: ImprovementCardEntry[] = [];
  const kickerOrRankImprovingCards: ImprovementCardEntry[] = [];
  const groupMatches: Card[][] = targetGroups.map(() => []);

  for (const card of remainingDeck) {
    const boardAfter = [...board, card];
    const after = evaluateHand([...heroCards, ...boardAfter]);
    const improvementKind = classifyImprovement(currentHand, after);

    const entry: ImprovementCardEntry = Object.freeze({
      card,
      before: currentHand,
      after,
      improvementKind,
    });

    candidates.push(entry);
    if (improvementKind !== 'none') {
      improvingCards.push(entry);
      if (improvementKind === 'category') {
        categoryImprovingCards.push(entry);
      } else {
        kickerOrRankImprovingCards.push(entry);
      }
    }

    if (targetGroups.length > 0) {
      const ctx: ImprovementCandidateContext = {
        card,
        before: currentHand,
        after,
        improvementKind,
        heroCards,
        boardBefore: board,
        boardAfter,
      };
      for (let i = 0; i < targetGroups.length; i++) {
        if (targetGroups[i]!.predicate(ctx)) {
          groupMatches[i]!.push(card);
        }
      }
    }
  }

  const targetGroupSummaries: TargetGroupImprovementSummary[] = targetGroups.map((group, i) => {
    const matched = groupMatches[i]!;
    return Object.freeze({
      id: group.id,
      label: group.label,
      metricKind: 'improvement-probability' as const,
      cards: Object.freeze(matched),
      count: matched.length,
      probabilities: calculateDrawProbabilities({
        outs: matched.length,
        street,
        unseenCards: unseenCardCount,
      }),
    });
  });

  return Object.freeze({
    street,
    currentHand,
    unseenCardCount,
    cardsRemainingToRiver,
    candidates: Object.freeze(candidates),
    improvingCards: Object.freeze(improvingCards),
    categoryImprovingCards: Object.freeze(categoryImprovingCards),
    kickerOrRankImprovingCards: Object.freeze(kickerOrRankImprovingCards),
    targetGroups: Object.freeze(targetGroupSummaries),
    probabilities: Object.freeze({
      anyImprovement: calculateDrawProbabilities({
        outs: improvingCards.length,
        street,
        unseenCards: unseenCardCount,
      }),
      categoryImprovement: calculateDrawProbabilities({
        outs: categoryImprovingCards.length,
        street,
        unseenCards: unseenCardCount,
      }),
      kickerOrRankImprovement: calculateDrawProbabilities({
        outs: kickerOrRankImprovingCards.length,
        street,
        unseenCards: unseenCardCount,
      }),
    }),
    metricKind: 'improvement-probability' as const,
  });
}

/**
 * Evaluates every unseen candidate card on flop/turn against an assumed opponent range
 * on the NEXT street after that card is dealt.
 *
 * Separates:
 * - `cleanOuts`: cards turning hero from trailing/tied into a 100% winner vs all valid combos;
 * - `mixedOuts`: cards flipping at least one combo from trailing/tied to win, while hero still
 *   loses or ties against at least one valid combo (dirty/partial outs, per QUESTIONS.md M2 #1);
 * - `chopOuts`: cards turning a losing spot into a tie without flipping any combo to a win;
 * - `improvementOnlyCards`: cards that strengthen hero's hand rank/category without flipping
 *   any combo from trailing/tied to win (e.g., already ahead, or improved yet still behind/overtaken);
 * - `blockedCards`: cards that collide with every combo in the opponent's range.
 */
export function analyzeOutsAgainstRange(
  input: AnalyzeOutsAgainstRangeInput,
): RangeOutsAnalysis {
  const {
    heroCards,
    board,
    opponentRange,
    deadCards = [],
    duplicatePolicy,
    assumptionsContext,
  } = input;

  if (!Array.isArray(heroCards) || heroCards.length !== 2) {
    throw new CalculatorError('invalid-combo', 'heroCards must contain exactly 2 cards');
  }

  const street = resolvePostflopStreet(board.length);
  const knownCards = [...heroCards, ...board, ...deadCards];
  const { mask: knownMask } = buildUniqueCardMask(knownCards, 'hero, board, and dead cards');

  const normalizedRange = normalizeOpponentRange(opponentRange, knownCards, {
    duplicatePolicy,
  });

  const currentHand = evaluateHand([...heroCards, ...board]);
  const remainingDeck = getRemainingDeck(knownMask);
  const unseenCardCount = remainingDeck.length;
  const cardsRemainingToRiver: 0 | 1 | 2 =
    street === 'flop' ? 2 : street === 'turn' ? 1 : 0;

  // Pre-evaluate opponent combos on the current street.
  const comboBeforeCmps: Array<-1 | 0 | 1> = [];
  let currentWinWeight = 0;
  let currentTieWeight = 0;

  for (const combo of normalizedRange.combos) {
    const oppBefore = evaluateHand([...combo.cards, ...board]);
    const cmp = compareHands(currentHand, oppBefore);
    comboBeforeCmps.push(cmp);
    if (cmp === 1) {
      currentWinWeight += combo.weight;
    } else if (cmp === 0) {
      currentTieWeight += combo.weight;
    }
  }
  const currentStreetEquity =
    (currentWinWeight + 0.5 * currentTieWeight) / normalizedRange.totalWeight;

  const baseNotes: string[] = [
    'Đánh giá từng lá ứng viên trên street kế tiếp sau khi loại combo đối thủ bị blocker bởi lá đó.',
    'Tách riêng clean outs (thắng sạch 100% combo hợp lệ sau khi lật thế), mixed/dirty outs (thắng một phần range nhưng vẫn thua/hòa combo khác) và lá chỉ cải thiện hạng bài/kicker (theo QUESTIONS.md M2 #1).',
    'Xác suất hit outs KHÔNG phải là xác suất thắng toàn ván (equity showdown được tính riêng).',
    ...(assumptionsContext?.notes ?? []),
  ];

  const assumptions: CalculationAssumptions = Object.freeze({
    method: 'exact-next-card-enumeration',
    street: assumptionsContext?.street ?? street,
    opponentCount: assumptionsContext?.opponentCount ?? 1,
    ranges: Object.freeze([normalizedRange.summary]),
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
    notes: Object.freeze(baseNotes),
  });

  if (cardsRemainingToRiver === 0) {
    const emptyProb = calculateDrawProbabilities({
      outs: 0,
      street: 'river',
      unseenCards: unseenCardCount,
    });
    return Object.freeze({
      street,
      currentHand,
      unseenCardCount,
      cardsRemainingToRiver: 0,
      currentStreetEquity,
      perCard: Object.freeze([]),
      cleanOuts: Object.freeze([]),
      mixedOuts: Object.freeze([]),
      chopOuts: Object.freeze([]),
      improvementOnlyCards: Object.freeze([]),
      nonOutCards: Object.freeze([]),
      blockedCards: Object.freeze([]),
      cleanOutProbabilities: emptyProb,
      cleanAndMixedOutProbabilities: emptyProb,
      assumptions,
    });
  }

  const perCard: RangeOutCardDetail[] = [];
  const cleanOuts: RangeOutCardDetail[] = [];
  const mixedOuts: RangeOutCardDetail[] = [];
  const chopOuts: RangeOutCardDetail[] = [];
  const improvementOnlyCards: RangeOutCardDetail[] = [];
  const nonOutCards: RangeOutCardDetail[] = [];
  const blockedCards: RangeOutCardDetail[] = [];

  for (const card of remainingDeck) {
    const boardAfter = [...board, card];
    const heroAfter = evaluateHand([...heroCards, ...boardAfter]);
    const improvementKind = classifyImprovement(currentHand, heroAfter);
    const cardBit = cardMaskBit(cardToIndex(card));

    let validComboCount = 0;
    let validWeight = 0;
    let winWeightBefore = 0;
    let tieWeightBefore = 0;
    let loseWeightBefore = 0;
    let winWeightAfter = 0;
    let tieWeightAfter = 0;
    let loseWeightAfter = 0;
    let flippedToWinWeight = 0;
    let flippedFromLoseToTieWeight = 0;
    let regressedWeight = 0;
    let winningComboCountAfter = 0;
    let tyingComboCountAfter = 0;
    let losingComboCountAfter = 0;

    for (let i = 0; i < normalizedRange.combos.length; i++) {
      const combo = normalizedRange.combos[i]!;
      if ((combo.maskLo & cardBit.lo) !== 0 || (combo.maskHi & cardBit.hi) !== 0) {
        continue;
      }

      const w = combo.weight;
      const beforeCmp = comboBeforeCmps[i]!;
      const oppAfter = evaluateHand([...combo.cards, ...boardAfter]);
      const afterCmp = compareHands(heroAfter, oppAfter);

      validComboCount++;
      validWeight += w;

      if (beforeCmp === 1) {
        winWeightBefore += w;
      } else if (beforeCmp === 0) {
        tieWeightBefore += w;
      } else {
        loseWeightBefore += w;
      }

      if (afterCmp === 1) {
        winWeightAfter += w;
        winningComboCountAfter++;
      } else if (afterCmp === 0) {
        tieWeightAfter += w;
        tyingComboCountAfter++;
      } else {
        loseWeightAfter += w;
        losingComboCountAfter++;
      }

      if (beforeCmp <= 0 && afterCmp === 1) {
        flippedToWinWeight += w;
      }
      if (beforeCmp === -1 && afterCmp === 0) {
        flippedFromLoseToTieWeight += w;
      }
      if (beforeCmp > afterCmp) {
        regressedWeight += w;
      }
    }

    let classification: RangeOutClassification;
    if (validComboCount === 0 || validWeight === 0) {
      classification = 'blocked-range';
    } else if (flippedToWinWeight > 0 && loseWeightAfter === 0 && tieWeightAfter === 0) {
      classification = 'clean-out';
    } else if (flippedToWinWeight > 0) {
      classification = 'mixed-out';
    } else if (flippedFromLoseToTieWeight > 0) {
      classification = 'chop-out';
    } else if (improvementKind !== 'none') {
      classification = 'improvement-only';
    } else {
      classification = 'non-out';
    }

    const detail: RangeOutCardDetail = Object.freeze({
      card,
      heroBefore: currentHand,
      heroAfter,
      improvementKind,
      classification,
      validOpponentComboCount: validComboCount,
      validOpponentWeight: validWeight,
      winWeightBefore,
      tieWeightBefore,
      loseWeightBefore,
      winWeightAfter,
      tieWeightAfter,
      loseWeightAfter,
      flippedToWinWeight,
      flippedFromLoseToTieWeight,
      regressedWeight,
      winningComboCountAfter,
      tyingComboCountAfter,
      losingComboCountAfter,
      winShareAfter: validWeight > 0 ? winWeightAfter / validWeight : 0,
      tieShareAfter: validWeight > 0 ? tieWeightAfter / validWeight : 0,
      loseShareAfter: validWeight > 0 ? loseWeightAfter / validWeight : 0,
      nextStreetEquityAfter:
        validWeight > 0 ? (winWeightAfter + 0.5 * tieWeightAfter) / validWeight : 0,
      stillLosesToSomeComboAfter: loseWeightAfter > 0,
    });

    perCard.push(detail);
    switch (classification) {
      case 'clean-out':
        cleanOuts.push(detail);
        break;
      case 'mixed-out':
        mixedOuts.push(detail);
        break;
      case 'chop-out':
        chopOuts.push(detail);
        break;
      case 'improvement-only':
        improvementOnlyCards.push(detail);
        break;
      case 'non-out':
        nonOutCards.push(detail);
        break;
      case 'blocked-range':
        blockedCards.push(detail);
        break;
    }
  }

  return Object.freeze({
    street,
    currentHand,
    unseenCardCount,
    cardsRemainingToRiver,
    currentStreetEquity,
    perCard: Object.freeze(perCard),
    cleanOuts: Object.freeze(cleanOuts),
    mixedOuts: Object.freeze(mixedOuts),
    chopOuts: Object.freeze(chopOuts),
    improvementOnlyCards: Object.freeze(improvementOnlyCards),
    nonOutCards: Object.freeze(nonOutCards),
    blockedCards: Object.freeze(blockedCards),
    cleanOutProbabilities: calculateDrawProbabilities({
      outs: cleanOuts.length,
      street,
      unseenCards: unseenCardCount,
    }),
    cleanAndMixedOutProbabilities: calculateDrawProbabilities({
      outs: cleanOuts.length + mixedOuts.length,
      street,
      unseenCards: unseenCardCount,
    }),
    assumptions,
  });
}
