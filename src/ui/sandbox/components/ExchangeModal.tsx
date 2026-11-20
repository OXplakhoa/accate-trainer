import { useMemo, useState } from 'react';
import {
  chipValue,
  DENOMINATIONS,
  emptyChips,
  type ChipCounts,
  type Denomination,
  type HandExchangeRequest,
  type HandState,
  type TableBoundaryState,
} from '../../../engine';
import { ChipSvg } from '../assets/ChipSvg';
import {
  isValidCustomExchange,
  suggestBoundaryAnteExchanges,
  suggestBreakdownsForSide,
  suggestPendingPayoutExchanges,
} from '../exchangeHelpers';
import { formatChipBreakdown, getPlayerName } from '../format';
import { HERO_PLAYER_ID, type SeatProfileInfo } from '../types';

export interface ExchangeModalProps {
  readonly mode: 'in-hand' | 'between-hands';
  readonly hand: HandState | null;
  readonly boundary: TableBoundaryState | null;
  readonly seatProfiles: Readonly<Record<string, SeatProfileInfo>>;
  readonly onExchangeInHand: (request: HandExchangeRequest) => void;
  readonly onExchangeAtBoundary: (
    fromPlayerId: string,
    toPlayerId: string,
    give: ChipCounts,
    receive: ChipCounts,
  ) => void;
  readonly onSettlePayout?: () => void;
  readonly onClose: () => void;
}

export function ExchangeModal({
  mode,
  hand,
  boundary,
  seatProfiles,
  onExchangeInHand,
  onExchangeAtBoundary,
  onSettlePayout,
  onClose,
}: ExchangeModalProps) {
  const seats = useMemo(
    () =>
      mode === 'in-hand' && hand !== null
        ? hand.seats.map((s) => ({ playerId: s.playerId, stack: s.stack }))
        : boundary !== null
          ? boundary.seats.map((s) => ({ playerId: s.playerId, stack: s.stack }))
          : [],
    [mode, hand, boundary],
  );

  const isAwaitingPayout = mode === 'in-hand' && hand?.phase === 'awaiting-payout';
  const defaultFrom =
    seats.some((s) => s.playerId === HERO_PLAYER_ID)
      ? HERO_PLAYER_ID
      : (seats[0]?.playerId ?? '');

  const [fromPlayerId, setFromPlayerId] = useState<string>(defaultFrom);
  const [targetKey, setTargetKey] = useState<string>(() => {
    if (isAwaitingPayout || (mode === 'in-hand' && hand !== null && chipValue(hand.pot) > 0)) {
      return 'pot';
    }
    const other = seats.find((s) => s.playerId !== defaultFrom);
    return other ? `player:${other.playerId}` : 'pot';
  });

  const [give, setGive] = useState<ChipCounts>(() => emptyChips());
  const [receive, setReceive] = useState<ChipCounts>(() => emptyChips());

  const nameOf = (id: string) => getPlayerName(id, seatProfiles);

  const activeFromSeat = seats.find((s) => s.playerId === fromPlayerId) ?? seats[0];
  const effectiveFromId = activeFromSeat?.playerId ?? '';
  const fromStack = activeFromSeat?.stack ?? emptyChips();

  const canTargetPot = mode === 'in-hand' && hand !== null && chipValue(hand.pot) > 0;
  const effectiveTargetKey =
    targetKey === 'pot' && !canTargetPot
      ? `player:${seats.find((s) => s.playerId !== effectiveFromId)?.playerId ?? ''}`
      : targetKey === `player:${effectiveFromId}`
        ? canTargetPot
          ? 'pot'
          : `player:${seats.find((s) => s.playerId !== effectiveFromId)?.playerId ?? ''}`
        : targetKey;

  const isPotTarget = effectiveTargetKey === 'pot';
  const targetPlayerId = isPotTarget ? null : effectiveTargetKey.replace(/^player:/, '');
  const targetStack: ChipCounts = isPotTarget
    ? (hand?.pot ?? emptyChips())
    : (seats.find((s) => s.playerId === targetPlayerId)?.stack ?? emptyChips());

  const targetLabel = isPotTarget
    ? 'Pot'
    : targetPlayerId
      ? nameOf(targetPlayerId)
      : '—';

  const pendingPayoutSuggestions = useMemo(() => {
    if (!isAwaitingPayout || hand === null) {
      return [];
    }
    return suggestPendingPayoutExchanges(hand, (id) => getPlayerName(id, seatProfiles));
  }, [isAwaitingPayout, hand, seatProfiles]);

  const missingAnteSuggestions = useMemo(() => {
    if (mode !== 'between-hands' || boundary === null) {
      return [];
    }
    const missingSeats = boundary.seats.filter((s) => chipValue(s.stack) > 0 && s.stack[5] < 1);
    return missingSeats.flatMap((s) =>
      suggestBoundaryAnteExchanges(boundary, s.playerId, (id) => getPlayerName(id, seatProfiles)),
    );
  }, [mode, boundary, seatProfiles]);

  const quickSuggestions = useMemo(() => {
    if (!effectiveFromId) {
      return [];
    }
    if (!isPotTarget && !targetPlayerId) {
      return [];
    }
    return suggestBreakdownsForSide({
      fromPlayerId: effectiveFromId,
      fromStack,
      counterpartyStack: targetStack,
      targetKind: isPotTarget ? 'pot' : 'player',
      ...(targetPlayerId ? { targetPlayerId } : {}),
      targetLabel,
    });
  }, [effectiveFromId, fromStack, targetStack, isPotTarget, targetPlayerId, targetLabel]);

  const validation = isValidCustomExchange(fromStack, targetStack, give, receive);

  const adjustGive = (denom: Denomination, delta: number) => {
    const next = Math.max(0, Math.min(fromStack[denom], give[denom] + delta));
    setGive({ ...give, [denom]: next });
  };

  const adjustReceive = (denom: Denomination, delta: number) => {
    const next = Math.max(0, Math.min(targetStack[denom], receive[denom] + delta));
    setReceive({ ...receive, [denom]: next });
  };

  const handleManualSubmit = () => {
    if (!validation.ok || !effectiveFromId) {
      return;
    }
    if (mode === 'in-hand') {
      onExchangeInHand({
        fromPlayerId: effectiveFromId,
        target: isPotTarget ? { kind: 'pot' } : { kind: 'player', playerId: targetPlayerId! },
        give,
        receive,
      });
    } else if (targetPlayerId) {
      onExchangeAtBoundary(effectiveFromId, targetPlayerId, give, receive);
    }
    setGive(emptyChips());
    setReceive(emptyChips());
  };

  return (
    <div
      className="sb-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sb-exchange-title"
    >
      <div className="sb-modal sb-modal--wide">
        <header className="sb-modal__header">
          <div>
            <h2 id="sb-exchange-title">Đổi chip (giữ nguyên tổng giá trị)</h2>
            <p className="sb-muted">
              Đổi chip lớn lấy chip nhỏ với người chơi khác hoặc với Pot (bất biến 6.500 điểm theo từng mệnh giá).
            </p>
          </div>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--sm" onClick={onClose}>
            Đóng
          </button>
        </header>

        <div className="sb-modal__body">
          {isAwaitingPayout && hand?.pendingPayout && (
            <div className="sb-exchange-callout">
              <h4>Pot đang chờ thanh toán chính xác</h4>
              <p className="sb-num">
                Pot hiện có: {chipValue(hand.pot)} điểm ({formatChipBreakdown(hand.pot)}) · Cần trả:{' '}
                {hand.pendingPayout.requiredPayouts
                  .map((p) => `${nameOf(p.playerId)} ${p.amount}`)
                  .join(' · ')}
              </p>
              {pendingPayoutSuggestions.length > 0 ? (
                <div className="sb-suggestion-list">
                  {pendingPayoutSuggestions.map((s, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="sb-btn sb-btn--accent sb-btn--sm"
                      onClick={() => onExchangeInHand(s.request)}
                    >
                      {s.labelVi}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="sb-muted">
                  Chưa có gợi ý tự động 1 bước; hãy chọn người đổi và mệnh giá thủ công bên dưới.
                </p>
              )}
              {onSettlePayout && (
                <button
                  type="button"
                  className="sb-btn sb-btn--primary sb-btn--sm"
                  onClick={onSettlePayout}
                >
                  Thử thanh toán Pot ngay
                </button>
              )}
            </div>
          )}

          {missingAnteSuggestions.length > 0 && (
            <div className="sb-exchange-callout">
              <h4>Gợi ý đổi chip lấy chip 5 để đóng ante</h4>
              <div className="sb-suggestion-list">
                {missingAnteSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="sb-btn sb-btn--accent sb-btn--sm"
                    onClick={() => {
                      if (s.targetPlayerId) {
                        onExchangeAtBoundary(s.fromPlayerId, s.targetPlayerId, s.give, s.receive);
                      }
                    }}
                  >
                    {nameOf(s.fromPlayerId)}: {s.labelVi}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sb-exchange-selectors">
            <label className="sb-field">
              <span>Người đổi chip</span>
              <select
                value={effectiveFromId}
                onChange={(e) => {
                  setFromPlayerId(e.target.value);
                  setGive(emptyChips());
                  setReceive(emptyChips());
                }}
              >
                {seats.map((s) => (
                  <option key={s.playerId} value={s.playerId}>
                    {nameOf(s.playerId)} ({chipValue(s.stack)} điểm)
                  </option>
                ))}
              </select>
            </label>

            <label className="sb-field">
              <span>Đổi với</span>
              <select
                value={effectiveTargetKey}
                onChange={(e) => {
                  setTargetKey(e.target.value);
                  setGive(emptyChips());
                  setReceive(emptyChips());
                }}
              >
                {canTargetPot && hand && (
                  <option value="pot">Pot ({chipValue(hand.pot)} điểm)</option>
                )}
                {seats
                  .filter((s) => s.playerId !== effectiveFromId)
                  .map((s) => (
                    <option key={s.playerId} value={`player:${s.playerId}`}>
                      {nameOf(s.playerId)} ({chipValue(s.stack)} điểm)
                    </option>
                  ))}
              </select>
            </label>
          </div>

          {quickSuggestions.length > 0 && (
            <div className="sb-exchange-section">
              <h4>Gợi ý đổi nhanh</h4>
              <div className="sb-suggestion-list">
                {quickSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="sb-btn sb-btn--secondary sb-btn--sm"
                    onClick={() => {
                      if (mode === 'in-hand') {
                        onExchangeInHand({
                          fromPlayerId: s.fromPlayerId,
                          target:
                            s.targetKind === 'pot'
                              ? { kind: 'pot' }
                              : { kind: 'player', playerId: s.targetPlayerId! },
                          give: s.give,
                          receive: s.receive,
                        });
                      } else if (s.targetPlayerId) {
                        onExchangeAtBoundary(s.fromPlayerId, s.targetPlayerId, s.give, s.receive);
                      }
                    }}
                  >
                    {s.labelVi}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sb-exchange-grid">
            <div className="sb-exchange-col">
              <h4>
                {nameOf(effectiveFromId)} đưa ra:{' '}
                <strong className="sb-num">{chipValue(give)} điểm</strong>
              </h4>
              {DENOMINATIONS.map((denom) => (
                <div key={denom} className="sb-denom-stepper">
                  <div className="sb-denom-stepper__label">
                    <ChipSvg denomination={denom} size={26} decorative />
                    <span className="sb-num">
                      {denom} (có {fromStack[denom]})
                    </span>
                  </div>
                  <div className="sb-denom-stepper__btns">
                    <button
                      type="button"
                      className="sb-btn sb-btn--ghost sb-btn--xs"
                      disabled={give[denom] <= 0}
                      onClick={() => adjustGive(denom, -1)}
                      aria-label={`Giảm chip ${denom} đưa ra`}
                    >
                      −
                    </button>
                    <span className="sb-num sb-denom-stepper__val">{give[denom]}</span>
                    <button
                      type="button"
                      className="sb-btn sb-btn--ghost sb-btn--xs"
                      disabled={give[denom] >= fromStack[denom]}
                      onClick={() => adjustGive(denom, 1)}
                      aria-label={`Tăng chip ${denom} đưa ra`}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="sb-exchange-col">
              <h4>
                Nhận từ {targetLabel}:{' '}
                <strong className="sb-num">{chipValue(receive)} điểm</strong>
              </h4>
              {DENOMINATIONS.map((denom) => (
                <div key={denom} className="sb-denom-stepper">
                  <div className="sb-denom-stepper__label">
                    <ChipSvg denomination={denom} size={26} decorative />
                    <span className="sb-num">
                      {denom} (có {targetStack[denom]})
                    </span>
                  </div>
                  <div className="sb-denom-stepper__btns">
                    <button
                      type="button"
                      className="sb-btn sb-btn--ghost sb-btn--xs"
                      disabled={receive[denom] <= 0}
                      onClick={() => adjustReceive(denom, -1)}
                      aria-label={`Giảm chip ${denom} nhận về`}
                    >
                      −
                    </button>
                    <span className="sb-num sb-denom-stepper__val">{receive[denom]}</span>
                    <button
                      type="button"
                      className="sb-btn sb-btn--ghost sb-btn--xs"
                      disabled={receive[denom] >= targetStack[denom]}
                      onClick={() => adjustReceive(denom, 1)}
                      aria-label={`Tăng chip ${denom} nhận về`}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {!validation.ok && (
            <p className="sb-validation-hint" role="status">
              {validation.reasonVi}
            </p>
          )}
        </div>

        <footer className="sb-modal__footer">
          <button
            type="button"
            className="sb-btn sb-btn--ghost"
            onClick={() => {
              setGive(emptyChips());
              setReceive(emptyChips());
            }}
          >
            Đặt lại
          </button>
          <button
            type="button"
            className="sb-btn sb-btn--primary"
            disabled={!validation.ok}
            onClick={handleManualSubmit}
          >
            Xác nhận đổi chip ({chipValue(give)} điểm)
          </button>
        </footer>
      </div>
    </div>
  );
}
