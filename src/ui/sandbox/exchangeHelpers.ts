import {
  addChips,
  chipValue,
  defaultBreakdown,
  DENOMINATIONS,
  emptyChips,
  planPotPayouts,
  subtractChips,
  type ChipCounts,
  type Denomination,
  type HandExchangeRequest,
  type HandState,
  type TableBoundaryState,
} from '../../engine';
import { formatChipBreakdown } from './format';

export interface ExchangeSuggestion {
  readonly id: string;
  readonly labelVi: string;
  readonly fromPlayerId: string;
  readonly targetKind: 'player' | 'pot';
  readonly targetPlayerId?: string;
  readonly give: ChipCounts;
  readonly receive: ChipCounts;
}

function singleChip(denom: Denomination): ChipCounts {
  return {
    5: denom === 5 ? 1 : 0,
    10: denom === 10 ? 1 : 0,
    50: denom === 50 ? 1 : 0,
    100: denom === 100 ? 1 : 0,
  };
}

/**
 * Generates practical equal-value breakdown suggestions for `fromStack` trading with `counterparty`
 * (e.g., breaking 100 -> 50/10/5, 50 -> 10/5, or 10 -> 2x5).
 */
export function suggestBreakdownsForSide(params: {
  readonly fromPlayerId: string;
  readonly fromStack: ChipCounts;
  readonly counterpartyStack: ChipCounts;
  readonly targetKind: 'player' | 'pot';
  readonly targetPlayerId?: string;
  readonly targetLabel: string;
  readonly requireSmallChip5?: boolean;
}): readonly ExchangeSuggestion[] {
  const suggestions: ExchangeSuggestion[] = [];
  const largeDenoms: readonly Denomination[] = [100, 50, 10];

  for (const denom of largeDenoms) {
    if (params.fromStack[denom] < 1) {
      continue;
    }

    // Standard greedy breakdown
    const standard = defaultBreakdown(denom, params.counterpartyStack);
    if (standard !== null && (!params.requireSmallChip5 || standard[5] > 0)) {
      const give = singleChip(denom);
      suggestions.push({
        id: `${params.fromPlayerId}-${params.targetKind}-${params.targetPlayerId ?? 'pot'}-std-${denom}`,
        labelVi: `Đổi 1×${denom} lấy ${formatChipBreakdown(standard)} từ ${params.targetLabel}`,
        fromPlayerId: params.fromPlayerId,
        targetKind: params.targetKind,
        ...(params.targetPlayerId !== undefined ? { targetPlayerId: params.targetPlayerId } : {}),
        give,
        receive: standard,
      });
    }

    // If caller specifically needs 5-chips (e.g., for ante or odd 5-point bet), also search
    // a breakdown that includes at least 2×5 when counterparty has 5s (since greedy prefers 10s/50s).
    if (params.counterpartyStack[5] >= 2 && (standard === null || standard[5] === 0)) {
      const receive5First = breakdownWithFivePriority(denom, params.counterpartyStack);
      if (receive5First !== null && receive5First[5] > 0) {
        const give = singleChip(denom);
        suggestions.push({
          id: `${params.fromPlayerId}-${params.targetKind}-${params.targetPlayerId ?? 'pot'}-five-${denom}`,
          labelVi: `Đổi 1×${denom} lấy ${formatChipBreakdown(receive5First)} (ưu tiên chip 5) từ ${params.targetLabel}`,
          fromPlayerId: params.fromPlayerId,
          targetKind: params.targetKind,
          ...(params.targetPlayerId !== undefined ? { targetPlayerId: params.targetPlayerId } : {}),
          give,
          receive: receive5First,
        });
      }
    }
  }

  return suggestions;
}

function breakdownWithFivePriority(chip: Denomination, counterparty: ChipCounts): ChipCounts | null {
  if (chip <= 5 || counterparty[5] < 2) {
    return null;
  }
  // Reserve 2×5 (= 10) first, then fill remainder with smaller denominations (< chip)
  const reservedFives = 2;
  let remaining = chip - reservedFives * 5;
  const result: Record<Denomination, number> = { 5: reservedFives, 10: 0, 50: 0, 100: 0 };

  const order: readonly Denomination[] = [50, 10, 5];
  for (const d of order) {
    if (d >= chip) {
      continue;
    }
    const available = d === 5 ? counterparty[5] - reservedFives : counterparty[d];
    const take = Math.min(available, Math.floor(remaining / d));
    result[d] += take;
    remaining -= take * d;
  }

  return remaining === 0 ? result : null;
}

/**
 * When `hand.phase === 'awaiting-payout'`, finds concrete legal exchanges between seated players
 * and the pot that break large pot chips into smaller denominations so `planPotPayouts` succeeds.
 */
export function suggestPendingPayoutExchanges(
  hand: HandState,
  nameOf: (playerId: string) => string,
): readonly {
  readonly request: HandExchangeRequest;
  readonly labelVi: string;
  readonly resolvesImmediately: boolean;
}[] {
  if (hand.phase !== 'awaiting-payout' || hand.pendingPayout === null) {
    return [];
  }

  const results: Array<{
    readonly request: HandExchangeRequest;
    readonly labelVi: string;
    readonly resolvesImmediately: boolean;
  }> = [];

  const largePotDenoms: readonly Denomination[] = [100, 50, 10];
  for (const potDenom of largePotDenoms) {
    if (hand.pot[potDenom] < 1) {
      continue;
    }
    const potGives = singleChip(potDenom);

    for (const seat of hand.seats) {
      // Player gives smaller chips to pot, receives 1 large chip from pot
      const candidates: ChipCounts[] = [];
      const std = defaultBreakdown(potDenom, seat.stack);
      if (std !== null) {
        candidates.push(std);
      }
      const fiveFirst = breakdownWithFivePriority(potDenom, seat.stack);
      if (
        fiveFirst !== null &&
        (std === null ||
          fiveFirst[5] !== std[5] ||
          fiveFirst[10] !== std[10] ||
          fiveFirst[50] !== std[50])
      ) {
        candidates.push(fiveFirst);
      }

      for (const playerGives of candidates) {
        const nextPot = addChips(subtractChips(hand.pot, potGives), playerGives);
        const resolvesImmediately =
          planPotPayouts(nextPot, hand.pendingPayout.requiredPayouts) !== null;
        results.push({
          request: {
            fromPlayerId: seat.playerId,
            target: { kind: 'pot' },
            give: playerGives,
            receive: potGives,
          },
          labelVi: `${nameOf(seat.playerId)} đưa ${formatChipBreakdown(playerGives)} vào Pot, nhận 1×${potDenom}${resolvesImmediately ? ' (đủ để thanh toán ngay)' : ''}`,
          resolvesImmediately,
        });
      }
    }
  }

  results.sort((a, b) => Number(b.resolvesImmediately) - Number(a.resolvesImmediately));
  return results.slice(0, 8);
}

/**
 * At table boundary, suggests legal player-to-player exchanges so `missingPlayerId` acquires
 * at least one 5-point chip needed for ante.
 */
export function suggestBoundaryAnteExchanges(
  boundary: TableBoundaryState,
  missingPlayerId: string,
  nameOf: (playerId: string) => string,
): readonly ExchangeSuggestion[] {
  const seat = boundary.seats.find((s) => s.playerId === missingPlayerId);
  if (seat === undefined) {
    return [];
  }

  const all: ExchangeSuggestion[] = [];
  for (const other of boundary.seats) {
    if (other.playerId === missingPlayerId || other.stack[5] < 2) {
      continue;
    }
    const list = suggestBreakdownsForSide({
      fromPlayerId: missingPlayerId,
      fromStack: seat.stack,
      counterpartyStack: other.stack,
      targetKind: 'player',
      targetPlayerId: other.playerId,
      targetLabel: nameOf(other.playerId),
      requireSmallChip5: true,
    });
    all.push(...list);
  }
  return all.slice(0, 6);
}

export function isValidCustomExchange(
  fromStack: ChipCounts,
  targetStack: ChipCounts,
  give: ChipCounts,
  receive: ChipCounts,
): { readonly ok: true } | { readonly ok: false; readonly reasonVi: string } {
  const giveVal = chipValue(give);
  const receiveVal = chipValue(receive);

  if (giveVal === 0 || receiveVal === 0) {
    return { ok: false, reasonVi: 'Chọn ít nhất 1 chip ở cả hai phía để đổi.' };
  }
  if (giveVal !== receiveVal) {
    return {
      ok: false,
      reasonVi: `Tổng giá trị chưa cân bằng: đưa ${giveVal} điểm ≠ nhận ${receiveVal} điểm.`,
    };
  }
  for (const denom of DENOMINATIONS) {
    if (give[denom] > fromStack[denom]) {
      return {
        ok: false,
        reasonVi: `Người đổi không đủ chip ${denom} trong stack hiện có.`,
      };
    }
    if (receive[denom] > targetStack[denom]) {
      return {
        ok: false,
        reasonVi: `Bên đối ứng không đủ chip ${denom} để đổi.`,
      };
    }
  }
  return { ok: true };
}

export function emptyExchangeSelection(): ChipCounts {
  return emptyChips();
}
