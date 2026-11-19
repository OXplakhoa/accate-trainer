import {
  checkReadyForNextHand,
  chipValue,
  MAX_PLAYERS,
  type TableBoundaryState,
} from '../../../engine';
import { formatChipBreakdown, formatNumberVi, getPlayerName } from '../format';
import { HERO_PLAYER_ID, type SeatProfileInfo } from '../types';

export interface BoundaryPanelProps {
  readonly boundary: TableBoundaryState;
  readonly seatProfiles: Readonly<Record<string, SeatProfileInfo>>;
  readonly hasPendingSettings: boolean;
  readonly onRebuyPlayer: (playerId: string) => void;
  readonly onCashOutPlayer: (playerId: string) => void;
  readonly onInviteRival: () => void;
  readonly onSeatHeroBack: () => void;
  readonly onOpenExchange: () => void;
  readonly onStartNextHand: () => void;
  readonly onOpenReview?: () => void;
}

export function BoundaryPanel({
  boundary,
  seatProfiles,
  hasPendingSettings,
  onRebuyPlayer,
  onCashOutPlayer,
  onInviteRival,
  onSeatHeroBack,
  onOpenExchange,
  onStartNextHand,
  onOpenReview,
}: BoundaryPanelProps) {
  const readiness = checkReadyForNextHand(boundary);
  const heroSeated = boundary.seats.some((s) => s.playerId === HERO_PLAYER_ID);
  const bankTotal = chipValue(boundary.bank);

  return (
    <section className="sb-boundary-panel" aria-label="Quản lý bàn giữa hai ván">
      <div className="sb-boundary-panel__head">
        <div>
          <h3>Ranh giới giữa hai ván</h3>
          <p className="sb-muted">
            Đang ngồi: <strong className="sb-num">{boundary.seats.length}</strong> người · Kho chip:{' '}
            <strong className="sb-num">{formatNumberVi(bankTotal)}</strong> ({formatChipBreakdown(boundary.bank)})
          </p>
        </div>
        <div className="sb-boundary-panel__primary">
          {onOpenReview && (
            <button type="button" className="sb-btn sb-btn--secondary" onClick={onOpenReview}>
              Xem lại ván trước
            </button>
          )}
          <button
            type="button"
            className="sb-btn sb-btn--primary"
            disabled={!readiness.ready}
            onClick={onStartNextHand}
          >
            Chia ván tiếp theo
          </button>
        </div>
      </div>

      {hasPendingSettings && (
        <div className="sb-inline-alert sb-inline-alert--info">
          Có thay đổi Cài đặt đang chờ — sẽ được áp dụng trước khi chia ván mới.
        </div>
      )}

      {!heroSeated && (
        <div className="sb-inline-alert sb-inline-alert--info">
          <span>Bạn đã rời bàn và cash out. Bạn có thể ngồi lại bàn với buy-in 500.</span>
          <button type="button" className="sb-btn sb-btn--accent sb-btn--sm" onClick={onSeatHeroBack}>
            Ngồi lại bàn (+500)
          </button>
        </div>
      )}

      {readiness.needsPlayers > 0 && (
        <div className="sb-inline-alert sb-inline-alert--warning" role="alert">
          <span>
            Bàn chỉ còn {readiness.playerCount} người (tối thiểu 4 người — luật T4). Cần mời thêm{' '}
            {readiness.needsPlayers} rival.
          </span>
          <button type="button" className="sb-btn sb-btn--accent sb-btn--sm" onClick={onInviteRival}>
            Mời rival mới (+500)
          </button>
        </div>
      )}

      {readiness.zeroStackPlayerIds.length > 0 && (
        <div className="sb-inline-alert sb-inline-alert--warning" role="alert">
          <div className="sb-boundary-list">
            <strong>Ghế còn 0 chip (T3 — phải Rebuy hoặc Rời bàn trước khi thu ante):</strong>
            {readiness.zeroStackPlayerIds.map((pid) => (
              <div key={pid} className="sb-boundary-item">
                <span>{getPlayerName(pid, seatProfiles)}</span>
                <div className="sb-boundary-item__btns">
                  <button
                    type="button"
                    className="sb-btn sb-btn--accent sb-btn--xs"
                    onClick={() => onRebuyPlayer(pid)}
                  >
                    Rebuy 500
                  </button>
                  <button
                    type="button"
                    className="sb-btn sb-btn--ghost sb-btn--xs"
                    onClick={() => onCashOutPlayer(pid)}
                  >
                    Rời bàn
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {readiness.missingAnteDenominationPlayerIds.length > 0 && (
        <div className="sb-inline-alert sb-inline-alert--warning" role="alert">
          <span>
            Thiếu chip 5 để đóng ante:{' '}
            {readiness.missingAnteDenominationPlayerIds
              .map((pid) => getPlayerName(pid, seatProfiles))
              .join(', ')}
            . Hãy đổi chip với người chơi khác trên bàn.
          </span>
          <button type="button" className="sb-btn sb-btn--accent sb-btn--sm" onClick={onOpenExchange}>
            Đổi chip ngay
          </button>
        </div>
      )}

      <div className="sb-boundary-footer">
        {boundary.seats.length < MAX_PLAYERS && (
          <button type="button" className="sb-btn sb-btn--secondary sb-btn--sm" onClick={onInviteRival}>
            + Mời thêm rival
          </button>
        )}
        <button type="button" className="sb-btn sb-btn--secondary sb-btn--sm" onClick={onOpenExchange}>
          Đổi chip giữa các ghế
        </button>
      </div>
    </section>
  );
}
