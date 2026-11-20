import {
  chipValue,
  DENOMINATIONS,
  emptyChips,
  profitLoss,
  summarizeLedger,
  type ChipCounts,
  type HandState,
  type LedgerEvent,
  type TableBoundaryState,
} from '../../../engine';
import { ChipSvg } from '../assets/ChipSvg';
import { formatNumberVi, getPlayerName } from '../format';
import { HERO_PLAYER_ID, type SeatProfileInfo } from '../types';

export interface LedgerDrawerProps {
  readonly ledgerEvents: readonly LedgerEvent[];
  readonly phase: 'in-hand' | 'between-hands';
  readonly hand: HandState | null;
  readonly boundary: TableBoundaryState | null;
  readonly seatProfiles: Readonly<Record<string, SeatProfileInfo>>;
  readonly onClose: () => void;
}

export function LedgerDrawer({
  ledgerEvents,
  phase,
  hand,
  boundary,
  seatProfiles,
  onClose,
}: LedgerDrawerProps) {
  const summary = summarizeLedger(ledgerEvents);
  const bank: ChipCounts =
    phase === 'in-hand' && hand !== null
      ? hand.bank
      : boundary !== null
        ? boundary.bank
        : emptyChips();
  const pot: ChipCounts =
    phase === 'in-hand' && hand !== null ? hand.pot : emptyChips();

  const currentStackMap = new Map<string, ChipCounts>();
  if (phase === 'in-hand' && hand !== null) {
    for (const s of hand.seats) {
      // Include any reserved out-of-turn chips as still belonging to player's stack
      const combined: ChipCounts = s.declaration
        ? {
            5: s.stack[5] + s.declaration.reservedChips[5],
            10: s.stack[10] + s.declaration.reservedChips[10],
            50: s.stack[50] + s.declaration.reservedChips[50],
            100: s.stack[100] + s.declaration.reservedChips[100],
          }
        : s.stack;
      currentStackMap.set(s.playerId, combined);
    }
  } else if (boundary !== null) {
    for (const s of boundary.seats) {
      currentStackMap.set(s.playerId, s.stack);
    }
  }

  const playerIds = Array.from(
    new Set([...Object.keys(summary), ...Array.from(currentStackMap.keys())]),
  ).sort((a, b) => {
    if (a === HERO_PLAYER_ID) return -1;
    if (b === HERO_PLAYER_ID) return 1;
    return a.localeCompare(b);
  });

  let totalTableStacks = 0;
  for (const stack of currentStackMap.values()) {
    totalTableStacks += chipValue(stack);
  }
  const potTotal = chipValue(pot);
  const bankTotal = chipValue(bank);

  return (
    <div
      className="sb-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sb-ledger-title"
    >
      <div className="sb-modal sb-modal--xl">
        <header className="sb-modal__header">
          <div>
            <h2 id="sb-ledger-title">Sổ phiên & Kho chip 6.500 điểm</h2>
            <p className="sb-muted">
              Theo dõi buy-in, rebuy, cash out và lãi/lỗ ròng từng người chơi theo AC C7.
            </p>
          </div>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--sm" onClick={onClose}>
            Đóng
          </button>
        </header>

        <div className="sb-modal__body">
          <div className="sb-bank-strip sb-num">
            <div className="sb-bank-strip__summary">
              <span>
                Kho chip: <strong>{formatNumberVi(bankTotal)}</strong>
              </span>
              <span>
                Stack trên bàn: <strong>{formatNumberVi(totalTableStacks)}</strong>
              </span>
              {potTotal > 0 && (
                <span>
                  Pot đang chơi: <strong>{formatNumberVi(potTotal)}</strong>
                </span>
              )}
              <span>
                Tổng hệ thống:{' '}
                <strong>{formatNumberVi(bankTotal + totalTableStacks + potTotal)} / 6.500</strong>
              </span>
            </div>
            <div className="sb-bank-strip__denoms">
              {DENOMINATIONS.map((d) => (
                <span key={d} className="sb-chip-pill">
                  <ChipSvg denomination={d} size={18} decorative />
                  <span>Kho: {bank[d]}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="sb-table-wrap">
            <table className="sb-table sb-num">
              <thead>
                <tr>
                  <th>Người chơi</th>
                  <th>Trạng thái</th>
                  <th>Buy-in</th>
                  <th>Rebuy</th>
                  <th>Đã nạp</th>
                  <th>Cash out</th>
                  <th>Stack hiện tại</th>
                  <th>Lãi / Lỗ</th>
                </tr>
              </thead>
              <tbody>
                {playerIds.map((pid) => {
                  const entry = summary[pid] ?? {
                    buyIns: 0,
                    rebuys: 0,
                    cashOuts: 0,
                    invested: 0,
                    cashedOut: 0,
                  };
                  const stack = currentStackMap.get(pid) ?? emptyChips();
                  const isSeated = currentStackMap.has(pid);
                  const net = profitLoss(entry, stack);
                  return (
                    <tr
                      key={pid}
                      className={pid === HERO_PLAYER_ID ? 'sb-row-highlight' : ''}
                    >
                      <td>
                        <strong>{getPlayerName(pid, seatProfiles)}</strong>
                      </td>
                      <td>{isSeated ? 'Đang ngồi' : 'Đã rời bàn'}</td>
                      <td>{entry.buyIns}</td>
                      <td>{entry.rebuys}</td>
                      <td>{formatNumberVi(entry.invested)}</td>
                      <td>{formatNumberVi(entry.cashedOut)}</td>
                      <td>{formatNumberVi(chipValue(stack))}</td>
                      <td className={net > 0 ? 'sb-net-pos' : net < 0 ? 'sb-net-neg' : ''}>
                        {net > 0 ? `+${formatNumberVi(net)}` : formatNumberVi(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {potTotal > 0 && (
            <p className="sb-muted">
              Lưu ý: Ván đang diễn ra — {formatNumberVi(potTotal)} điểm đang nằm trong Pot chưa thanh toán.
            </p>
          )}
        </div>

        <footer className="sb-modal__footer">
          <button type="button" className="sb-btn sb-btn--primary" onClick={onClose}>
            Đóng sổ phiên
          </button>
        </footer>
      </div>
    </div>
  );
}
