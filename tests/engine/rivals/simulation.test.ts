import { describe, expect, it } from 'vitest';
import { initialDistribution } from '../../../src/engine/bank';
import { createRng } from '../../../src/engine/rng';
import {
  buildRivalDecisionInput,
  createInitialNongTiltState,
  decideRivalAction,
  decideRivalOutOfTurn,
  RIVAL_IDS,
  type NongTiltState,
  type RivalId,
} from '../../../src/engine/rivals';
import {
  assertHandInvariants,
  mustApply,
  mustDeclare,
  mustStartHand,
} from '../handTestHelpers';

export interface ArchetypeSimulationStats {
  readonly label: string;
  readonly rivalId: RivalId;
  readonly isTilted: boolean;
  readonly hands: number;
  readonly totalDecisions: number;
  readonly canRaiseOpportunities: number;
  readonly raises: number;
  readonly raiseRate: number;
  readonly canBetOrRaiseOpportunities: number;
  readonly betsAndRaises: number;
  readonly aggressionRate: number;
  readonly facingRaiseOpportunities: number;
  readonly foldsFacingRaise: number;
  readonly foldToRaiseRate: number;
  readonly checkRaises: number;
  readonly outOfTurnOpportunities: number;
  readonly outOfTurnDeclarations: number;
  readonly outOfTurnRate: number;
}

const OPPONENT_LINEUP: readonly RivalId[] = ['soi', 'cao', 'bay'];
const TABLE_SIZE = 4;
const TARGET_PLAYER_ID = 'target-rival';

function runArchetypeSimulation1000(
  rivalId: RivalId,
  options?: {
    readonly label?: string;
    readonly tiltState?: NongTiltState;
    readonly handCount?: number;
  },
): ArchetypeSimulationStats {
  const handCount = options?.handCount ?? 1000;
  const tiltState = options?.tiltState;
  const init = initialDistribution(TABLE_SIZE);

  let totalDecisions = 0;
  let canRaiseOpportunities = 0;
  let raises = 0;
  let canBetOrRaiseOpportunities = 0;
  let betsAndRaises = 0;
  let facingRaiseOpportunities = 0;
  let foldsFacingRaise = 0;
  let checkRaises = 0;
  let outOfTurnOpportunities = 0;
  let outOfTurnDeclarations = 0;

  for (let h = 0; h < handCount; h++) {
    const targetSeatIdx = h % TABLE_SIZE;
    const dealerIndex = (h + TABLE_SIZE - 1) % TABLE_SIZE;
    const seats = [];
    const rivalByPlayerId = new Map<string, RivalId>();
    let oppCursor = 0;

    for (let s = 0; s < TABLE_SIZE; s++) {
      if (s === targetSeatIdx) {
        seats.push({ seatIndex: s, playerId: TARGET_PLAYER_ID, stack: init.perPlayer });
        rivalByPlayerId.set(TARGET_PLAYER_ID, rivalId);
      } else {
        const oppRivalId = OPPONENT_LINEUP[oppCursor++]!;
        const pid = `opp-${s}-${oppRivalId}`;
        seats.push({ seatIndex: s, playerId: pid, stack: init.perPlayer });
        rivalByPlayerId.set(pid, oppRivalId);
      }
    }

    let state = mustStartHand({
      seats,
      bank: init.bank,
      rng: createRng(`sim-deal-${h}`),
      config: { dealerIndex, allowOutOfTurn: true },
    }).state;

    let stepIndex = 0;
    let checkedOotStreet: string | null = null;

    while (state.phase === 'betting' && state.activePlayerId !== null) {
      const actorId = state.activePlayerId;

      // Once per street before target rival's first turn on that street, evaluate out-of-turn declaration
      if (actorId !== TARGET_PLAYER_ID && checkedOotStreet !== state.street) {
        const targetSeat = state.seats.find((s) => s.playerId === TARGET_PLAYER_ID)!;
        if (
          targetSeat.status === 'active' &&
          targetSeat.declaration === null &&
          !(targetSeat.hasActedThisStreet && targetSeat.streetContribution === state.currentBet)
        ) {
          checkedOotStreet = state.street;
          outOfTurnOpportunities += 1;
          const ootDto = buildRivalDecisionInput(state, TARGET_PLAYER_ID, {
            rivalId,
            ...(tiltState !== undefined ? { tiltState } : {}),
          });
          const ootDecision = decideRivalOutOfTurn(
            ootDto,
            createRng(`sim-oot-${h}-${state.street}`),
          );
          if (ootDecision.action !== null) {
            state = mustDeclare(state, TARGET_PLAYER_ID, ootDecision.action).state;
            outOfTurnDeclarations += 1;
          }
        }
      }

      const actorRivalId = rivalByPlayerId.get(actorId)!;
      const isTarget = actorId === TARGET_PLAYER_ID;
      const dto = buildRivalDecisionInput(state, actorId, {
        rivalId: actorRivalId,
        ...(isTarget && tiltState !== undefined ? { tiltState } : {}),
      });

      const legal = dto.legalActions!;
      let hasRaiseOnStreet = false;
      let targetCheckedEarlierThisStreet = false;
      for (const ev of dto.publicTimeline) {
        if (ev.type === 'player-action' && ev.street === dto.street) {
          if (ev.action.type === 'raise') {
            hasRaiseOnStreet = true;
          }
          if (ev.playerId === TARGET_PLAYER_ID && ev.action.type === 'check') {
            targetCheckedEarlierThisStreet = true;
          }
        }
      }

      const facingRaise =
        legal.toCall > 0 && (hasRaiseOnStreet || legal.playerStreetContribution > 0);

      const decision = decideRivalAction(
        dto,
        createRng(`sim-act-${h}-${stepIndex}-${actorId}`),
      );

      if (isTarget) {
        totalDecisions += 1;
        if (legal.canRaise) {
          canRaiseOpportunities += 1;
          if (decision.action.type === 'raise') {
            raises += 1;
            if (targetCheckedEarlierThisStreet) {
              checkRaises += 1;
            }
          }
        }
        if (legal.canBet || legal.canRaise) {
          canBetOrRaiseOpportunities += 1;
          if (decision.action.type === 'bet' || decision.action.type === 'raise') {
            betsAndRaises += 1;
          }
        }
        if (facingRaise) {
          facingRaiseOpportunities += 1;
          if (decision.action.type === 'fold') {
            foldsFacingRaise += 1;
          }
        }
      }

      state = mustApply(state, actorId, decision.action).state;
      stepIndex += 1;
    }

    expect(state.phase).toBe('complete');
    assertHandInvariants(state);
  }

  return {
    label: options?.label ?? rivalId,
    rivalId,
    isTilted: Boolean(tiltState?.isTilted && tiltState.handsRemaining > 0),
    hands: handCount,
    totalDecisions,
    canRaiseOpportunities,
    raises,
    raiseRate: canRaiseOpportunities > 0 ? raises / canRaiseOpportunities : 0,
    canBetOrRaiseOpportunities,
    betsAndRaises,
    aggressionRate:
      canBetOrRaiseOpportunities > 0 ? betsAndRaises / canBetOrRaiseOpportunities : 0,
    facingRaiseOpportunities,
    foldsFacingRaise,
    foldToRaiseRate:
      facingRaiseOpportunities > 0 ? foldsFacingRaise / facingRaiseOpportunities : 0,
    checkRaises,
    outOfTurnOpportunities,
    outOfTurnDeclarations,
    outOfTurnRate:
      outOfTurnOpportunities > 0 ? outOfTurnDeclarations / outOfTurnOpportunities : 0,
  };
}

describe('P2b rivals — 1,000-hand statistical verification (B2, B6)', () => {
  it(
    'B2: separates all rival archetypes over 1,000 fixed-seed hands (raise rate: Điên > Sói > Cáo > Cá; fold-to-raise highest: Thỏ)',
    () => {
      const statsByRival = new Map<RivalId, ArchetypeSimulationStats>();

      for (const rivalId of RIVAL_IDS) {
        const stats = runArchetypeSimulation1000(rivalId, {
          label: rivalId,
          ...(rivalId === 'nong' ? { tiltState: createInitialNongTiltState() } : {}),
        });
        statsByRival.set(rivalId, stats);

        expect(stats.hands).toBe(1000);
        expect(stats.canRaiseOpportunities).toBeGreaterThan(150);
        expect(stats.facingRaiseOpportunities).toBeGreaterThan(50);
      }

      const dien = statsByRival.get('dien')!;
      const soi = statsByRival.get('soi')!;
      const cao = statsByRival.get('cao')!;
      const ca = statsByRival.get('ca')!;
      const da = statsByRival.get('da')!;
      const tho = statsByRival.get('tho')!;
      const bay = statsByRival.get('bay')!;

      // AC B2: Raise frequency when canRaise is true: Điên > Sói > Cáo > Cá
      expect(dien.raiseRate).toBeGreaterThan(soi.raiseRate);
      expect(soi.raiseRate).toBeGreaterThan(cao.raiseRate);
      expect(cao.raiseRate).toBeGreaterThan(ca.raiseRate);

      // Also verify overall aggression (bet + raise when canBet || canRaise): Điên > Sói > Cáo > Đá > Cá
      expect(dien.aggressionRate).toBeGreaterThan(soi.aggressionRate);
      expect(soi.aggressionRate).toBeGreaterThan(cao.aggressionRate);
      expect(cao.aggressionRate).toBeGreaterThan(da.aggressionRate);
      expect(da.aggressionRate).toBeGreaterThan(ca.aggressionRate);

      // AC B2: Thỏ has the highest fold-to-raise rate among all 9 archetypes
      for (const [otherId, otherStats] of statsByRival.entries()) {
        if (otherId !== 'tho') {
          expect(tho.foldToRaiseRate).toBeGreaterThan(otherStats.foldToRaiseRate);
        }
      }

      // Spec §4.1: Bẫy check-raises more often than TAG/Nit/Station profiles
      expect(bay.checkRaises).toBeGreaterThan(cao.checkRaises);
      expect(bay.checkRaises).toBeGreaterThan(da.checkRaises);
      expect(bay.checkRaises).toBeGreaterThan(ca.checkRaises);

      // Spec §3.4: Điên and Sói declare out-of-turn much more frequently than Đá and Thỏ
      expect(dien.outOfTurnRate).toBeGreaterThan(soi.outOfTurnRate);
      expect(soi.outOfTurnRate).toBeGreaterThan(cao.outOfTurnRate);
      expect(cao.outOfTurnRate).toBeGreaterThan(da.outOfTurnRate);
      expect(cao.outOfTurnRate).toBeGreaterThan(tho.outOfTurnRate);
    },
    25_000,
  );

  it(
    'B6: Nóng tilted vs Nóng normal over 1,000 fixed-seed hands shows significantly higher raise rate, aggression, and out-of-turn declarations',
    () => {
      const normalStats = runArchetypeSimulation1000('nong', {
        label: 'nong-normal',
        tiltState: createInitialNongTiltState(),
      });

      const tiltedState: NongTiltState = {
        isTilted: true,
        handsRemaining: 4,
        totalTiltDuration: 4,
        triggerReason: 'big-pot-loss',
      };
      const tiltStats = runArchetypeSimulation1000('nong', {
        label: 'nong-tilted',
        tiltState: tiltedState,
      });

      expect(normalStats.hands).toBe(1000);
      expect(tiltStats.hands).toBe(1000);

      // AC B6: Raise frequency when tilted is markedly higher than when normal
      expect(tiltStats.raiseRate).toBeGreaterThan(normalStats.raiseRate * 2.2);
      expect(tiltStats.aggressionRate).toBeGreaterThan(normalStats.aggressionRate * 1.8);
      expect(tiltStats.outOfTurnRate).toBeGreaterThan(normalStats.outOfTurnRate * 3);
      expect(tiltStats.foldToRaiseRate).toBeLessThan(normalStats.foldToRaiseRate);
    },
    15_000,
  );
});
