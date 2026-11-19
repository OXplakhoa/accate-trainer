import type { Card, Suit } from '../cards';
import { evaluateHand, type HandCategory } from '../handEval';

export interface HandStrengthAssessment {
  readonly madeStrength: number;
  readonly drawStrength: number;
  readonly effectiveStrength: number;
  readonly category: HandCategory | 'preflop';
  readonly hasStrongDraw: boolean;
  readonly hasWeakDraw: boolean;
  readonly usesHoleCard: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function evaluatePreflopPair(holeCards: readonly [Card, Card]): HandStrengthAssessment {
  const [c1, c2] = holeCards;
  const high = Math.max(c1.rank, c2.rank);
  const low = Math.min(c1.rank, c2.rank);
  const gap = high - low;
  const suited = c1.suit === c2.suit;

  let madeStrength: number;
  let drawStrength = 0;

  if (c1.rank === c2.rank) {
    madeStrength = clamp(0.56 + (high - 2) * 0.036, 0.56, 0.99);
    drawStrength = 0.08;
  } else {
    madeStrength = 0.08 + (high - 2) * 0.028 + (low - 2) * 0.015;
    if (suited) {
      madeStrength += 0.06;
      drawStrength += 0.14;
    }
    if (gap === 1) {
      madeStrength += 0.05;
      drawStrength += 0.14;
    } else if (gap === 2) {
      madeStrength += 0.03;
      drawStrength += 0.10;
    } else if (gap === 3) {
      madeStrength += 0.01;
      drawStrength += 0.06;
    }
    if (high >= 12 && low >= 10) {
      madeStrength += 0.07;
    }
  }

  const clampedMade = clamp(madeStrength, 0.05, 0.99);
  const clampedDraw = clamp(drawStrength, 0, 0.35);
  return {
    madeStrength: clampedMade,
    drawStrength: clampedDraw,
    effectiveStrength: clamp(clampedMade + clampedDraw * 0.45, 0.05, 0.99),
    category: 'preflop',
    hasStrongDraw: clampedDraw >= 0.24,
    hasWeakDraw: clampedDraw > 0 && clampedDraw < 0.24,
    usesHoleCard: true,
  };
}

function detectDrawStrength(
  holeCards: readonly [Card, Card],
  board: readonly Card[],
  category: HandCategory,
): { readonly drawStrength: number; readonly hasStrongDraw: boolean; readonly hasWeakDraw: boolean } {
  // No cards left to come on the river, and made flushes/straights+ don't need draw equity.
  if (board.length >= 5) {
    return { drawStrength: 0, hasStrongDraw: false, hasWeakDraw: false };
  }
  const alreadyStraightOrBetter =
    category === 'straight' ||
    category === 'flush' ||
    category === 'full-house' ||
    category === 'four-of-a-kind' ||
    category === 'straight-flush';
  if (alreadyStraightOrBetter) {
    return { drawStrength: 0, hasStrongDraw: false, hasWeakDraw: false };
  }

  const allCards = [...holeCards, ...board];
  const suitCounts: Record<Suit, number> = { s: 0, h: 0, d: 0, c: 0 };
  const holeSuitCounts: Record<Suit, number> = { s: 0, h: 0, d: 0, c: 0 };

  for (const c of allCards) {
    suitCounts[c.suit] += 1;
  }
  for (const c of holeCards) {
    holeSuitCounts[c.suit] += 1;
  }

  let flushDrawScore = 0;
  for (const suit of ['s', 'h', 'd', 'c'] as const) {
    if (holeSuitCounts[suit] > 0) {
      if (suitCounts[suit] === 4) {
        flushDrawScore = 0.34;
        break;
      }
      if (board.length === 3 && suitCounts[suit] === 3 && holeSuitCounts[suit] === 2) {
        flushDrawScore = Math.max(flushDrawScore, 0.11);
      } else if (board.length === 3 && suitCounts[suit] === 3) {
        flushDrawScore = Math.max(flushDrawScore, 0.07);
      }
    }
  }

  // Straight draw detection using rank bitmask (Ace counts as both 14 and 1).
  let rankMask = 0;
  let boardMask = 0;
  for (const c of allCards) {
    rankMask |= 1 << c.rank;
    if (c.rank === 14) {
      rankMask |= 1 << 1;
    }
  }
  for (const c of board) {
    boardMask |= 1 << c.rank;
    if (c.rank === 14) {
      boardMask |= 1 << 1;
    }
  }

  // Count how many distinct ranks (2..14) would complete a 5-card straight using at least one hole card.
  let straightOutRanks = 0;
  for (let candidateRank = 2; candidateRank <= 14; candidateRank++) {
    const bit = (1 << candidateRank) | (candidateRank === 14 ? 1 << 1 : 0);
    if ((rankMask & bit) !== 0) {
      continue;
    }
    const nextAllMask = rankMask | bit;
    const nextBoardMask = boardMask | bit;
    let completesWithHole = false;
    for (let high = 14; high >= 5; high--) {
      const windowMask = 31 << (high - 4);
      if (
        (nextAllMask & windowMask) === windowMask &&
        (nextBoardMask & windowMask) !== windowMask
      ) {
        completesWithHole = true;
        break;
      }
    }
    if (completesWithHole) {
      straightOutRanks += 1;
    }
  }

  let straightDrawScore = 0;
  if (straightOutRanks >= 2) {
    // Open-ended or double-gutshot (8 outs)
    straightDrawScore = 0.28;
  } else if (straightOutRanks === 1) {
    // Gutshot (4 outs)
    straightDrawScore = 0.15;
  }

  // Overcard draw bonus when holding high card only
  const maxBoardRank = board.reduce((max, c) => (c.rank > max ? c.rank : max), 2);
  let overcardScore = 0;
  if (category === 'high-card') {
    const overcards =
      (holeCards[0].rank > maxBoardRank ? 1 : 0) + (holeCards[1].rank > maxBoardRank ? 1 : 0);
    if (overcards === 2) {
      overcardScore = 0.12;
    } else if (overcards === 1) {
      overcardScore = 0.06;
    }
  }

  const totalDraw = clamp(flushDrawScore + straightDrawScore + overcardScore, 0, 0.56);
  const hasStrongDraw = flushDrawScore >= 0.30 || straightDrawScore >= 0.26 || totalDraw >= 0.32;
  const hasWeakDraw = !hasStrongDraw && totalDraw >= 0.06;

  return {
    drawStrength: totalDraw,
    hasStrongDraw,
    hasWeakDraw,
  };
}

/**
 * Evaluates a rival's 2 hole cards + revealed board (0, 3, 4, or 5 cards) into deterministic
 * made-hand strength and draw strength in [0, 1].
 */
export function evaluateRivalHandProfile(
  holeCards: readonly [Card, Card],
  board: readonly Card[],
  drawBoost = 0.65,
): HandStrengthAssessment {
  if (board.length === 0) {
    return evaluatePreflopPair(holeCards);
  }

  const handVal = evaluateHand([...holeCards, ...board]);
  const [c1, c2] = holeCards;
  const highHole = Math.max(c1.rank, c2.rank);
  const lowHole = Math.min(c1.rank, c2.rank);
  const sortedBoardRanks = board.map((c) => c.rank).sort((a, b) => b - a);
  const maxBoardRank = sortedBoardRanks[0] ?? 2;
  const secondBoardRank = sortedBoardRanks[1] ?? 2;

  const boardRankCounts = new Map<number, number>();
  for (const c of board) {
    boardRankCounts.set(c.rank, (boardRankCounts.get(c.rank) ?? 0) + 1);
  }

  const holeMatchesBoard1 = boardRankCounts.has(c1.rank);
  const holeMatchesBoard2 = boardRankCounts.has(c2.rank);
  const isPocketPair = c1.rank === c2.rank;

  let madeStrength = 0.10;
  let usesHoleCard = true;

  switch (handVal.category) {
    case 'straight-flush':
      madeStrength = 0.99;
      break;

    case 'four-of-a-kind':
      madeStrength = 0.97;
      break;

    case 'full-house':
      madeStrength = 0.93 + ((handVal.ranks[0] ?? 2) - 2) * 0.003;
      break;

    case 'flush':
      madeStrength = 0.86 + ((handVal.ranks[0] ?? 2) - 2) * 0.006;
      break;

    case 'straight':
      madeStrength = 0.80 + ((handVal.ranks[0] ?? 5) - 5) * 0.005;
      break;

    case 'three-of-a-kind': {
      const tripRank = handVal.ranks[0] ?? 2;
      const boardCount = boardRankCounts.get(tripRank) ?? 0;
      if (boardCount >= 3) {
        usesHoleCard = false;
        madeStrength = 0.28 + (highHole - 2) * 0.015;
      } else if (isPocketPair) {
        // Set (pocket pair hitting the board)
        madeStrength = 0.75 + (tripRank - 2) * 0.005;
      } else {
        // Trips (one hole card matching a board pair)
        madeStrength = 0.70 + (tripRank - 2) * 0.005 + (highHole - 2) * 0.003;
      }
      break;
    }

    case 'two-pair': {
      const topPairRank = handVal.ranks[0] ?? 2;
      const secondPairRank = handVal.ranks[1] ?? 2;
      if (holeMatchesBoard1 && holeMatchesBoard2 && !isPocketPair) {
        // Both hole cards paired the board
        madeStrength = 0.65 + (topPairRank - 2) * 0.006;
      } else if (isPocketPair && c1.rank > maxBoardRank) {
        // Overpair + board pair
        madeStrength = 0.62 + (c1.rank - 2) * 0.006;
      } else if (isPocketPair || holeMatchesBoard1 || holeMatchesBoard2) {
        // One pair from hole card(s) + one pair on board
        const myPairRank = isPocketPair
          ? c1.rank
          : holeMatchesBoard1
            ? c1.rank
            : c2.rank;
        madeStrength =
          myPairRank >= maxBoardRank
            ? 0.54 + (myPairRank - 2) * 0.006
            : 0.42 + (myPairRank - 2) * 0.005;
      } else {
        // Both pairs are on the board
        usesHoleCard = false;
        madeStrength = 0.20 + (highHole - 2) * 0.012 + (secondPairRank - 2) * 0.002;
      }
      break;
    }

    case 'pair': {
      const pairRank = handVal.ranks[0] ?? 2;
      const boardCount = boardRankCounts.get(pairRank) ?? 0;
      if (boardCount >= 2) {
        // Pair is solely on the board
        usesHoleCard = false;
        madeStrength = 0.14 + (highHole - 2) * 0.010 + (lowHole - 2) * 0.003;
      } else if (isPocketPair) {
        if (pairRank > maxBoardRank) {
          // Overpair
          madeStrength = 0.58 + (pairRank - 2) * 0.007;
        } else if (pairRank > secondBoardRank) {
          // Second pair pocket
          madeStrength = 0.42 + (pairRank - 2) * 0.006;
        } else {
          // Underpair
          madeStrength = 0.28 + (pairRank - 2) * 0.005;
        }
      } else {
        const kicker = c1.rank === pairRank ? c2.rank : c1.rank;
        if (pairRank >= maxBoardRank) {
          // Top pair
          madeStrength = 0.48 + (pairRank - 2) * 0.004 + (kicker - 2) * 0.005;
        } else if (pairRank >= secondBoardRank) {
          // Middle / second pair
          madeStrength = 0.35 + (pairRank - 2) * 0.004 + (kicker - 2) * 0.004;
        } else {
          // Bottom pair
          madeStrength = 0.25 + (pairRank - 2) * 0.004 + (kicker - 2) * 0.003;
        }
      }
      break;
    }

    case 'high-card':
      usesHoleCard = false;
      madeStrength = 0.06 + (highHole - 2) * 0.008 + (lowHole - 2) * 0.004;
      break;
  }

  const clampedMade = clamp(madeStrength, 0.05, 0.99);
  const drawInfo = detectDrawStrength(holeCards, board, handVal.category);
  const effectiveStrength = clamp(
    clampedMade + drawInfo.drawStrength * 0.55 * drawBoost,
    0.05,
    0.99,
  );

  return {
    madeStrength: clampedMade,
    drawStrength: drawInfo.drawStrength,
    effectiveStrength,
    category: handVal.category,
    hasStrongDraw: drawInfo.hasStrongDraw,
    hasWeakDraw: drawInfo.hasWeakDraw,
    usesHoleCard,
  };
}
