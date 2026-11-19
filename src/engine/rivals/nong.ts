import type { Card, Suit } from '../cards';
import { compareHands, evaluateHand } from '../handEval';
import type { HandState } from '../handTypes';
import type { Rng } from '../rng';
import type {
  NongTiltEvaluation,
  NongTiltState,
  PublicHandResultSummary,
  PublicShowdownPotSummary,
  RivalValidationResult,
} from './types';

export const NONG_RIVAL_ID = 'nong' as const;
export const NONG_TILT_POT_THRESHOLD = 150;
export const NONG_MIN_TILT_HANDS = 3;
export const NONG_MAX_TILT_HANDS = 5;

const VALID_SUITS: ReadonlySet<string> = new Set<Suit>(['s', 'h', 'd', 'c']);

function cloneCard(card: Card): Card {
  return Object.freeze({ rank: card.rank, suit: card.suit });
}

function cardKey(card: Card): string {
  return `${card.rank}:${card.suit}`;
}

function isValidCard(card: unknown): card is Card {
  if (typeof card !== 'object' || card === null) {
    return false;
  }
  const rec = card as Record<string, unknown>;
  return (
    typeof rec['rank'] === 'number' &&
    Number.isInteger(rec['rank']) &&
    rec['rank'] >= 2 &&
    rec['rank'] <= 14 &&
    typeof rec['suit'] === 'string' &&
    VALID_SUITS.has(rec['suit'])
  );
}

/**
 * Creates the initial non-tilted state for Nóng (spec §4.1.1, D45).
 */
export function createInitialNongTiltState(): NongTiltState {
  return Object.freeze({
    isTilted: false,
    handsRemaining: 0,
    totalTiltDuration: 0,
    triggerReason: null,
  });
}

/**
 * Draws a deterministic tilt duration in [3, 5] hands using `rng.fork('nong-tilt-duration')` (B5).
 */
export function sampleNongTiltDuration(rng: Rng): number {
  return NONG_MIN_TILT_HANDS + rng.fork('nong-tilt-duration').int(NONG_MAX_TILT_HANDS - NONG_MIN_TILT_HANDS + 1);
}

/**
 * Between-hands boundary adapter that extracts ONLY public showdown information from a completed
 * `HandState` (spec §4.1.1, B5, B7).
 * Never reads or copies hole cards of players who folded before showdown or when a hand ended by fold-win.
 */
export function summarizeCompletedHandForRivals(handState: HandState): PublicHandResultSummary {
  if (handState.phase !== 'complete' || handState.outcome === null) {
    throw new Error('Cannot summarize hand before phase is "complete"');
  }

  const seatedPlayerIds = Object.freeze(handState.seats.map((s) => s.playerId));
  const board = Object.freeze(handState.board.map(cloneCard));

  if (handState.outcome.kind === 'fold-win') {
    return Object.freeze({
      seatedPlayerIds,
      outcomeKind: 'fold-win',
      board,
      revealedShowdownCards: Object.freeze({}),
      potAwards: Object.freeze([]),
    });
  }

  const resolution = handState.outcome.resolution;
  const eligibleAtShowdown = new Set<string>();
  const potAwards: PublicShowdownPotSummary[] = resolution.potAwards.map((pot) => {
    for (const pid of pot.eligiblePlayerIds) {
      eligibleAtShowdown.add(pid);
    }
    return Object.freeze({
      potIndex: pot.potIndex,
      potAmount: pot.potAmount,
      eligiblePlayerIds: Object.freeze([...pot.eligiblePlayerIds]),
      tiedTopPlayerIds: Object.freeze([...pot.tiedTopPlayerIds]),
      awards: Object.freeze(
        pot.awards.map((a) => Object.freeze({ playerId: a.playerId, amount: a.amount })),
      ),
    });
  });

  const revealedShowdownCards: Record<string, readonly [Card, Card]> = {};
  for (const seat of handState.seats) {
    if (seat.status !== 'folded' && eligibleAtShowdown.has(seat.playerId)) {
      revealedShowdownCards[seat.playerId] = Object.freeze([
        cloneCard(seat.holeCards[0]),
        cloneCard(seat.holeCards[1]),
      ] as const);
    }
  }

  return Object.freeze({
    seatedPlayerIds,
    outcomeKind: 'showdown',
    board,
    revealedShowdownCards: Object.freeze(revealedShowdownCards),
    potAwards: Object.freeze(potAwards),
  });
}

/**
 * Runtime structural validator for `PublicHandResultSummary`.
 * Rejects summaries that contain unrevealed hole cards (e.g. folded players or fold-win hands).
 */
export function validatePublicHandResultSummary(summary: unknown): RivalValidationResult {
  if (typeof summary !== 'object' || summary === null || Array.isArray(summary)) {
    return { ok: false, reason: 'Summary must be a non-null plain object' };
  }
  const rec = summary as Record<string, unknown>;

  if (!Array.isArray(rec['seatedPlayerIds']) || rec['seatedPlayerIds'].length === 0) {
    return { ok: false, reason: 'seatedPlayerIds must be a non-empty array' };
  }

  const outcomeKind = rec['outcomeKind'];
  if (outcomeKind !== 'fold-win' && outcomeKind !== 'showdown') {
    return { ok: false, reason: `Invalid outcomeKind: ${String(outcomeKind)}` };
  }

  const board = rec['board'];
  if (!Array.isArray(board)) {
    return { ok: false, reason: 'board must be an array' };
  }
  const seenCards = new Set<string>();
  for (const c of board) {
    if (!isValidCard(c)) {
      return { ok: false, reason: 'Invalid card in summary.board' };
    }
    const key = cardKey(c);
    if (seenCards.has(key)) {
      return { ok: false, reason: `Duplicate card in summary.board: ${key}` };
    }
    seenCards.add(key);
  }

  const revealed = rec['revealedShowdownCards'];
  if (typeof revealed !== 'object' || revealed === null || Array.isArray(revealed)) {
    return { ok: false, reason: 'revealedShowdownCards must be an object' };
  }
  const revealedRec = revealed as Record<string, unknown>;

  const potAwards = rec['potAwards'];
  if (!Array.isArray(potAwards)) {
    return { ok: false, reason: 'potAwards must be an array' };
  }

  if (outcomeKind === 'fold-win') {
    if (Object.keys(revealedRec).length > 0) {
      return {
        ok: false,
        reason: 'fold-win summary must not contain revealedShowdownCards',
      };
    }
    if (potAwards.length > 0) {
      return { ok: false, reason: 'fold-win summary must not contain showdown potAwards' };
    }
    return { ok: true };
  }

  if (board.length !== 5) {
    return {
      ok: false,
      reason: `Showdown summary requires 5 board cards, received ${board.length}`,
    };
  }

  const eligiblePlayers = new Set<string>();
  for (const pot of potAwards) {
    if (typeof pot !== 'object' || pot === null) {
      return { ok: false, reason: 'Invalid potAward entry' };
    }
    const potRec = pot as Record<string, unknown>;
    if (
      typeof potRec['potIndex'] !== 'number' ||
      typeof potRec['potAmount'] !== 'number' ||
      potRec['potAmount'] < 0 ||
      !Array.isArray(potRec['eligiblePlayerIds']) ||
      !Array.isArray(potRec['tiedTopPlayerIds']) ||
      !Array.isArray(potRec['awards'])
    ) {
      return { ok: false, reason: 'Malformed potAward fields in summary' };
    }
    for (const pid of potRec['eligiblePlayerIds']) {
      if (typeof pid === 'string') {
        eligiblePlayers.add(pid);
      }
    }
  }

  for (const [playerId, pair] of Object.entries(revealedRec)) {
    if (!eligiblePlayers.has(playerId)) {
      return {
        ok: false,
        reason: `Unrevealed/folded player "${playerId}" must not appear in revealedShowdownCards`,
      };
    }
    if (!Array.isArray(pair) || pair.length !== 2 || !isValidCard(pair[0]) || !isValidCard(pair[1])) {
      return {
        ok: false,
        reason: `Invalid hole card pair for revealed player "${playerId}"`,
      };
    }
    const k0 = cardKey(pair[0]);
    const k1 = cardKey(pair[1]);
    if (k0 === k1 || seenCards.has(k0) || seenCards.has(k1)) {
      return {
        ok: false,
        reason: `Duplicate or colliding card in revealedShowdownCards for "${playerId}"`,
      };
    }
    seenCards.add(k0);
    seenCards.add(k1);
  }

  return { ok: true };
}

/**
 * Evaluates whether a completed hand's public showdown outcome triggers tilt for Nóng (B5, B7):
 * - Only considers showdown pots where Nóng is in `eligiblePlayerIds`.
 * - Distinguishes an outright lost pot (`award === 0` for Nóng) from a split pot share (`award > 0`).
 * - Triggers `'big-pot-loss'` if Nóng lost an eligible pot with `potAmount >= 150`.
 * - Triggers `'turn-bad-beat'` if Nóng lost an eligible pot after leading on the turn (6-card
 *   evaluation on the first 4 board cards + revealed hole cards of eligible players in that pot).
 */
export function evaluateNongTiltTrigger(
  summary: PublicHandResultSummary,
  nongPlayerId: string = NONG_RIVAL_ID,
): NongTiltEvaluation {
  const validation = validatePublicHandResultSummary(summary);
  if (!validation.ok) {
    throw new Error(
      `Invalid PublicHandResultSummary: ${validation.reason ?? 'unknown validation error'}`,
    );
  }

  const noTrigger: NongTiltEvaluation = Object.freeze({
    triggered: false,
    reason: null,
    triggeringPotIndex: null,
    triggeringPotAmount: null,
  });

  if (
    summary.outcomeKind !== 'showdown' ||
    !summary.seatedPlayerIds.includes(nongPlayerId)
  ) {
    return noTrigger;
  }

  const nongHoleCards = summary.revealedShowdownCards[nongPlayerId];
  if (nongHoleCards === undefined) {
    // Nóng folded before showdown and was not eligible for any showdown pot
    return noTrigger;
  }

  const turnBoard = summary.board.slice(0, 4);
  const nongTurnHand = evaluateHand([...nongHoleCards, ...turnBoard]);

  for (const pot of summary.potAwards) {
    if (!pot.eligiblePlayerIds.includes(nongPlayerId)) {
      continue;
    }

    // Check how much Nóng received from this pot
    let nongAward = 0;
    for (const award of pot.awards) {
      if (award.playerId === nongPlayerId) {
        nongAward += award.amount;
      }
    }

    // If Nóng won or received any split share of this pot, Nóng did not lose this pot outright
    if (nongAward > 0) {
      continue;
    }

    // Trigger 1: Lost an eligible showdown pot of >= 150 points
    if (pot.potAmount >= NONG_TILT_POT_THRESHOLD) {
      return Object.freeze({
        triggered: true,
        reason: 'big-pot-loss',
        triggeringPotIndex: pot.potIndex,
        triggeringPotAmount: pot.potAmount,
      });
    }

    // Trigger 2: Lost an eligible showdown pot after leading on the turn (6-card evaluation
    // against all other revealed eligible players in this pot)
    let comparedOpponents = 0;
    let strictlyAheadOfAll = true;

    for (const otherId of pot.eligiblePlayerIds) {
      if (otherId === nongPlayerId) {
        continue;
      }
      const otherHoleCards = summary.revealedShowdownCards[otherId];
      if (otherHoleCards === undefined) {
        strictlyAheadOfAll = false;
        break;
      }
      comparedOpponents += 1;
      const otherTurnHand = evaluateHand([...otherHoleCards, ...turnBoard]);
      if (compareHands(nongTurnHand, otherTurnHand) <= 0) {
        strictlyAheadOfAll = false;
        break;
      }
    }

    if (comparedOpponents > 0 && strictlyAheadOfAll) {
      return Object.freeze({
        triggered: true,
        reason: 'turn-bad-beat',
        triggeringPotIndex: pot.potIndex,
        triggeringPotAmount: pot.potAmount,
      });
    }
  }

  return noTrigger;
}

/**
 * Updates Nóng's tilt state at the between-hands boundary after a hand completes (B5–B7, QUESTIONS.md M2 #2):
 * - If Nóng was already tilted during the hand just played, decrements `handsRemaining` by 1
 *   (keeping the active 3–5 hand tilt window without re-extending on a new trigger while tilted),
 *   and returns to normal when `handsRemaining` reaches 0.
 * - If Nóng was normal during the hand just played and `evaluateNongTiltTrigger` fires,
 *   starts tilt for the NEXT hand lasting 3–5 hands (sampled deterministically via `rng`).
 */
export function updateNongTiltStateAtBoundary(
  currentState: NongTiltState,
  summary: PublicHandResultSummary,
  rng: Rng,
  nongPlayerId: string = NONG_RIVAL_ID,
): NongTiltState {
  const validation = validatePublicHandResultSummary(summary);
  if (!validation.ok) {
    throw new Error(
      `Invalid PublicHandResultSummary: ${validation.reason ?? 'unknown validation error'}`,
    );
  }

  if (!summary.seatedPlayerIds.includes(nongPlayerId)) {
    return currentState;
  }

  // When already tilted during the hand just played, count 1 completed tilt hand (QUESTIONS.md M2 #2)
  if (currentState.isTilted && currentState.handsRemaining > 0) {
    const nextRemaining = currentState.handsRemaining - 1;
    if (nextRemaining <= 0) {
      return createInitialNongTiltState();
    }
    return Object.freeze({
      isTilted: true,
      handsRemaining: nextRemaining,
      totalTiltDuration: currentState.totalTiltDuration,
      triggerReason: currentState.triggerReason,
    });
  }

  const evalResult = evaluateNongTiltTrigger(summary, nongPlayerId);
  if (evalResult.triggered && evalResult.reason !== null) {
    const duration = sampleNongTiltDuration(rng);
    return Object.freeze({
      isTilted: true,
      handsRemaining: duration,
      totalTiltDuration: duration,
      triggerReason: evalResult.reason,
    });
  }

  return createInitialNongTiltState();
}
