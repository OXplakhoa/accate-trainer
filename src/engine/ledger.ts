import { chipValue, type ChipCounts } from './chips';

export type LedgerEvent =
  | { readonly type: 'buy-in'; readonly playerId: string; readonly chips: ChipCounts }
  | { readonly type: 'rebuy'; readonly playerId: string; readonly chips: ChipCounts }
  | { readonly type: 'cash-out'; readonly playerId: string; readonly chips: ChipCounts };

export interface PlayerLedger {
  readonly buyIns: number;
  readonly rebuys: number;
  readonly cashOuts: number;
  readonly invested: number;
  readonly cashedOut: number;
}

interface MutablePlayerLedger {
  buyIns: number;
  rebuys: number;
  cashOuts: number;
  invested: number;
  cashedOut: number;
}

/**
 * Aggregates per-player buy-in, rebuy, and cash-out counts and point values from chip events (AC C7).
 */
export function summarizeLedger(
  events: readonly LedgerEvent[],
): Readonly<Record<string, PlayerLedger>> {
  const byPlayer = new Map<string, MutablePlayerLedger>();

  for (const event of events) {
    const value = chipValue(event.chips);
    let entry = byPlayer.get(event.playerId);
    if (entry === undefined) {
      entry = { buyIns: 0, rebuys: 0, cashOuts: 0, invested: 0, cashedOut: 0 };
      byPlayer.set(event.playerId, entry);
    }

    switch (event.type) {
      case 'buy-in':
        entry.buyIns += 1;
        entry.invested += value;
        break;
      case 'rebuy':
        entry.rebuys += 1;
        entry.invested += value;
        break;
      case 'cash-out':
        entry.cashOuts += 1;
        entry.cashedOut += value;
        break;
    }
  }

  const summary = Object.create(null) as Record<string, PlayerLedger>;
  for (const [playerId, entry] of byPlayer) {
    summary[playerId] = { ...entry };
  }
  return summary;
}

/**
 * Computes net profit/loss for a player: `cashedOut + value(currentStack) - invested` (AC C7).
 */
export function profitLoss(ledger: PlayerLedger, currentStack: ChipCounts): number {
  return ledger.cashedOut + chipValue(currentStack) - ledger.invested;
}
