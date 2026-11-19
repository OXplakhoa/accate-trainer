import { useState, type ReactNode } from 'react';
import {
  chipValue,
  DENOMINATIONS,
  type Card,
  type ChipCounts,
  type Denomination,
} from '../../../engine';
import { ChipSvg } from '../assets/ChipSvg';
import { PlayingCard } from '../assets/PlayingCard';
import {
  formatNumberVi,
  formatPercentVi,
  formatRaiseLabel,
  tTerm,
} from '../format';
import type { HeroActionValidation, TerminologyLanguage } from '../types';

export interface HeroControlsProps {
  readonly heroCards: readonly [Card, Card] | null;
  readonly availableStack: ChipCounts;
  readonly stagedChips: ChipCounts;
  readonly validation: HeroActionValidation;
  readonly potValue: number;
  readonly streetCap: number;
  readonly terminology: TerminologyLanguage;
  readonly isHeroSeated?: boolean;
  readonly pendingHeroLeave: boolean;
  readonly isAwaitingPayout: boolean;
  readonly isHandComplete: boolean;
  readonly disableMidHandFeedback?: boolean;
  readonly timerSlot?: ReactNode;
  readonly canPracticeSpot: boolean;
  readonly onStageChip: (denom: Denomination) => void;
  readonly onUnstageChip: (denom: Denomination) => void;
  readonly onUndoLastChip: () => void;
  readonly onClearStaged: () => void;
  readonly onAction: (type: 'fold' | 'check' | 'call' | 'bet' | 'raise') => void;
  readonly onDeclareOutOfTurn: (type: 'check' | 'call' | 'bet' | 'raise') => void;
  readonly onOpenExchange: () => void;
  readonly onRequestLeave: () => void;
  readonly onPracticeSpot?: () => void;
  readonly onSettlePayout?: () => void;
  readonly onOpenReview?: () => void;
  readonly onNextHand?: () => void;
}

export function HeroControls({
  heroCards,
  availableStack,
  stagedChips,
  validation,
  potValue,
  streetCap,
  terminology,
  isHeroSeated,
  pendingHeroLeave,
  isAwaitingPayout,
  isHandComplete,
  disableMidHandFeedback = false,
  timerSlot,
  canPracticeSpot,
  onStageChip,
  onUnstageChip,
  onUndoLastChip,
  onClearStaged,
  onAction,
  onDeclareOutOfTurn,
  onOpenExchange,
  onRequestLeave,
  onPracticeSpot,
  onSettlePayout,
  onOpenReview,
  onNextHand,
}: HeroControlsProps) {
  const [confirmingFreeFold, setConfirmingFreeFold] = useState(false);
  const heroSeated = isHeroSeated ?? heroCards !== null;

  const canPickChips =
    heroSeated &&
    !isHandComplete &&
    !isAwaitingPayout &&
    (validation.isHeroTurn || validation.canDeclareOutOfTurn);

  const stagedValue = validation.stagedValue;
  const requiredEquityPreview =
    !disableMidHandFeedback &&
    validation.legalActions !== null &&
    validation.legalActions.callAmount !== null &&
    validation.legalActions.callAmount > 0
      ? validation.legalActions.callAmount /
        (potValue + validation.legalActions.callAmount)
      : null;

  const handleFoldClick = () => {
    if (validation.foldNeedsConfirm && !confirmingFreeFold) {
      setConfirmingFreeFold(true);
      return;
    }
    setConfirmingFreeFold(false);
    onAction('fold');
  };

  return (
    <section className="sb-hero-console" aria-label="Bảng điều khiển Hero">
      <div className="sb-hero-console__top">
        <div className="sb-hero-cards-block">
          {heroCards !== null ? (
            <div className="sb-hero-cards">
              <PlayingCard card={heroCards[0]} size="md" />
              <PlayingCard card={heroCards[1]} size="md" />
            </div>
          ) : (
            <div className="sb-hero-cards sb-hero-cards--empty">
              <span>Chưa ngồi bàn</span>
            </div>
          )}

          <div className="sb-hero-summary">
            <div className="sb-hero-summary__line">
              <span className="sb-label">Stack còn lại:</span>
              <strong className="sb-num">{formatNumberVi(chipValue(availableStack))} điểm</strong>
            </div>
            <div className="sb-hero-summary__line">
              <span className="sb-label">
                {tTerm('cap', terminology)} street:
              </span>
              <span className="sb-num">{streetCap}</span>
              {requiredEquityPreview !== null && (
                <span className="sb-odds-chip sb-num">
                  {tTerm('potOdds', terminology)}: {formatPercentVi(requiredEquityPreview)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Dedicated slot for P5 Tournament countdown clock */}
        {timerSlot !== undefined && (
          <div className="sb-timer-slot" data-slot="tournament-timer">
            {timerSlot}
          </div>
        )}

        <div className="sb-hero-utility">
          <button
            type="button"
            className="sb-btn sb-btn--secondary"
            onClick={onOpenExchange}
          >
            Đổi chip
          </button>
          {canPracticeSpot && onPracticeSpot && (
            <button
              type="button"
              className="sb-btn sb-btn--secondary"
              onClick={onPracticeSpot}
            >
              Luyện spot này
            </button>
          )}
          <button
            type="button"
            className="sb-btn sb-btn--ghost"
            onClick={onRequestLeave}
            disabled={!heroSeated || pendingHeroLeave}
            title={!heroSeated ? 'Chỉ dùng được khi bạn đang ngồi bàn' : undefined}
          >
            {pendingHeroLeave && heroSeated ? 'Sẽ rời cuối ván' : 'Rời bàn'}
          </button>
        </div>
      </div>

      {isAwaitingPayout && (
        <div className="sb-console-banner sb-console-banner--warning" role="alert">
          <p>
            Pot chưa thể trả chính xác do thiếu mệnh giá chip nhỏ. Mở <strong>Đổi chip</strong> với Pot rồi bấm thanh toán.
          </p>
          <div className="sb-console-banner__actions">
            <button type="button" className="sb-btn sb-btn--accent" onClick={onOpenExchange}>
              Đổi chip với Pot
            </button>
            {onSettlePayout && (
              <button type="button" className="sb-btn sb-btn--primary" onClick={onSettlePayout}>
                Thanh toán Pot
              </button>
            )}
          </div>
        </div>
      )}

      {isHandComplete && (
        <div className="sb-console-banner sb-console-banner--complete">
          <p>Ván đã kết thúc. Bạn có thể xem phân tích chi tiết hoặc chia ván tiếp theo.</p>
          <div className="sb-console-banner__actions">
            {onOpenReview && (
              <button type="button" className="sb-btn sb-btn--secondary" onClick={onOpenReview}>
                Xem lại ván
              </button>
            )}
            {onNextHand && (
              <button type="button" className="sb-btn sb-btn--primary" onClick={onNextHand}>
                Ván tiếp theo
              </button>
            )}
          </div>
        </div>
      )}

      {!isHandComplete && !isAwaitingPayout && (
        <>
          <div className="sb-chip-picker" aria-label="Chọn từng chip vật lý để đặt cược">
            <div className="sb-chip-rack">
              {DENOMINATIONS.map((denom, idx) => {
                const count = availableStack[denom];
                return (
                  <button
                    key={denom}
                    type="button"
                    className="sb-chip-btn"
                    disabled={!canPickChips || count <= 0}
                    onClick={() => onStageChip(denom)}
                    aria-label={`Thêm 1 chip ${denom} (còn ${count}, phím ${idx + 1})`}
                    title={`Phím tắt ${idx + 1}: thêm chip ${denom}`}
                  >
                    <ChipSvg denomination={denom} size={42} decorative />
                    <span className="sb-chip-btn__count sb-num">×{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="sb-staged-tray" aria-live="polite">
              <div className="sb-staged-tray__header">
                <span className="sb-label">Chip đã chọn:</span>
                <strong className="sb-staged-tray__total sb-num">{stagedValue} điểm</strong>
              </div>
              <div className="sb-staged-tray__chips">
                {stagedValue === 0 ? (
                  <span className="sb-muted">Bấm từng chip để ghép khoản cược</span>
                ) : (
                  DENOMINATIONS.map((denom) =>
                    stagedChips[denom] > 0 ? (
                      <button
                        key={denom}
                        type="button"
                        className="sb-staged-chip-pill"
                        onClick={() => onUnstageChip(denom)}
                        aria-label={`Bỏ bớt 1 chip ${denom} khỏi khay cược`}
                      >
                        <ChipSvg denomination={denom} size={22} decorative />
                        <span className="sb-num">×{stagedChips[denom]}</span>
                        <span aria-hidden="true">−</span>
                      </button>
                    ) : null,
                  )
                )}
              </div>
              <div className="sb-staged-tray__controls">
                <button
                  type="button"
                  className="sb-btn sb-btn--ghost sb-btn--xs"
                  onClick={onUndoLastChip}
                  disabled={stagedValue === 0}
                >
                  Bỏ chip vừa chọn
                </button>
                <button
                  type="button"
                  className="sb-btn sb-btn--ghost sb-btn--xs"
                  onClick={onClearStaged}
                  disabled={stagedValue === 0}
                >
                  Xóa hết
                </button>
              </div>
            </div>
          </div>

          {validation.hasBindingDeclaration && (
            <div className="sb-console-note" role="status">
              Bạn đã hô trước lượt. Lời hô đang có hiệu lực (không thể rút khi mức cược chưa đổi — luật X6).
            </div>
          )}

          {validation.validationHintVi && (
            <p className="sb-validation-hint" role="status">
              {validation.validationHintVi}
            </p>
          )}

          {confirmingFreeFold && validation.isHeroTurn && (
            <div className="sb-confirm-fold" role="alertdialog" aria-label="Xác nhận Fold khi có thể Check">
              <span>Bạn có thể Check miễn phí. Chắc chắn muốn Fold?</span>
              <div className="sb-confirm-fold__btns">
                <button
                  type="button"
                  className="sb-btn sb-btn--danger sb-btn--sm"
                  onClick={() => {
                    setConfirmingFreeFold(false);
                    onAction('fold');
                  }}
                >
                  Xác nhận Fold
                </button>
                <button
                  type="button"
                  className="sb-btn sb-btn--ghost sb-btn--sm"
                  onClick={() => setConfirmingFreeFold(false)}
                >
                  Hủy
                </button>
              </div>
            </div>
          )}

          <div className="sb-action-bar" role="group" aria-label="Hành động cược">
            {validation.isHeroTurn ? (
              <>
                <button
                  type="button"
                  className="sb-btn sb-btn--danger"
                  disabled={!validation.canFold}
                  onClick={handleFoldClick}
                >
                  {tTerm('fold', terminology)}
                </button>

                {validation.canCheck && (
                  <button
                    type="button"
                    className="sb-btn sb-btn--secondary"
                    onClick={() => {
                      setConfirmingFreeFold(false);
                      onAction('check');
                    }}
                  >
                    {tTerm('check', terminology)}
                  </button>
                )}

                {validation.legalActions?.canBet && (
                  <button
                    type="button"
                    className="sb-btn sb-btn--primary"
                    disabled={!validation.canConfirmBet}
                    onClick={() => onAction('bet')}
                    data-action-btn="bet"
                  >
                    {validation.canConfirmBet && validation.betAmount !== null
                      ? `${tTerm('bet', terminology)} ${validation.betAmount}`
                      : `${tTerm('bet', terminology)} (${validation.legalActions.betRange?.min ?? 5}–${validation.legalActions.betRange?.max ?? 50})`}
                  </button>
                )}

                {validation.legalActions?.canCall && validation.callAmount !== null && (
                  <button
                    type="button"
                    className="sb-btn sb-btn--primary"
                    disabled={!validation.canConfirmCall}
                    onClick={() => onAction('call')}
                    data-action-btn="call"
                  >
                    {validation.isCallAllIn
                      ? `${tTerm('allIn', terminology)} ${validation.callAmount}`
                      : `${tTerm('call', terminology)} ${validation.callAmount}`}
                  </button>
                )}

                {validation.legalActions?.canRaise && validation.legalActions.raiseRange !== null && (
                  <button
                    type="button"
                    className="sb-btn sb-btn--accent"
                    disabled={!validation.canConfirmRaise}
                    onClick={() => onAction('raise')}
                    data-action-btn="raise"
                  >
                    {validation.canConfirmRaise &&
                    validation.raiseToAmount !== null &&
                    validation.raiseAddedAmount !== null
                      ? formatRaiseLabel(
                          validation.raiseToAmount,
                          validation.raiseAddedAmount,
                          terminology,
                        )
                      : `${tTerm('raise', terminology)} (${validation.legalActions.raiseRange.min}–${validation.legalActions.raiseRange.max})`}
                  </button>
                )}
              </>
            ) : validation.canDeclareOutOfTurn ? (
              <>
                <span className="sb-oot-prefix">{tTerm('declareEarly', terminology)}:</span>
                {validation.canCheck && (
                  <button
                    type="button"
                    className="sb-btn sb-btn--secondary"
                    onClick={() => onDeclareOutOfTurn('check')}
                  >
                    Hô trước: {tTerm('check', terminology)}
                  </button>
                )}
                {validation.legalActions?.canBet && (
                  <button
                    type="button"
                    className="sb-btn sb-btn--accent"
                    disabled={!validation.canConfirmBet}
                    onClick={() => onDeclareOutOfTurn('bet')}
                  >
                    Hô trước: {tTerm('bet', terminology)}{' '}
                    {validation.betAmount ?? '—'}
                  </button>
                )}
                {validation.legalActions?.canCall && validation.callAmount !== null && (
                  <button
                    type="button"
                    className="sb-btn sb-btn--accent"
                    disabled={!validation.canConfirmCall}
                    onClick={() => onDeclareOutOfTurn('call')}
                  >
                    Hô trước: {tTerm('call', terminology)} {validation.callAmount}
                  </button>
                )}
                {validation.legalActions?.canRaise && (
                  <button
                    type="button"
                    className="sb-btn sb-btn--accent"
                    disabled={!validation.canConfirmRaise}
                    onClick={() => onDeclareOutOfTurn('raise')}
                  >
                    Hô trước:{' '}
                    {validation.raiseToAmount !== null && validation.raiseAddedAmount !== null
                      ? formatRaiseLabel(
                          validation.raiseToAmount,
                          validation.raiseAddedAmount,
                          terminology,
                        )
                      : tTerm('raise', terminology)}
                  </button>
                )}
              </>
            ) : (
              <span className="sb-muted">
                {!heroSeated
                  ? 'Bạn đang xem bàn (chưa ngồi ghế) — có thể ngồi lại ở ranh giới ván…'
                  : pendingHeroLeave
                    ? 'Đang chờ các đối thủ kết thúc ván để rời bàn…'
                    : 'Đang chờ lượt đối thủ…'}
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
