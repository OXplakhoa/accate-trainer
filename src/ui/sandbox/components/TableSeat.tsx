import { useState } from 'react';
import {
  chipValue,
  DENOMINATIONS,
  type Card,
  type ChipCounts,
  type OutOfTurnDeclaration,
  type PlayerStatus,
  type RivalSeatMetadata,
} from '../../../engine';
import { ChipSvg } from '../assets/ChipSvg';
import { PlayingCard } from '../assets/PlayingCard';
import { RivalAvatar } from '../assets/RivalAvatar';
import { formatBettingActionShort, formatNumberVi } from '../format';
import type { TerminologyLanguage } from '../types';

export interface TableSeatProps {
  readonly seatIndex: number;
  readonly playerId: string;
  readonly displayName: string;
  readonly isHero: boolean;
  readonly rivalMetadata: RivalSeatMetadata | null;
  readonly stack: ChipCounts;
  readonly holeCards?: readonly [Card, Card] | null;
  readonly cardsRevealed: boolean;
  readonly status?: PlayerStatus;
  readonly streetContribution?: number;
  readonly isActiveTurn: boolean;
  readonly isDealer: boolean;
  readonly isOpener: boolean;
  readonly declaration: OutOfTurnDeclaration | null;
  readonly isWinner?: boolean;
  readonly isBetweenHands: boolean;
  readonly terminology: TerminologyLanguage;
  readonly forceExpandDetails?: boolean;
  readonly onBoundaryRebuy?: (playerId: string) => void;
  readonly onBoundaryCashOut?: (playerId: string) => void;
}

export function TableSeat({
  seatIndex,
  playerId,
  displayName,
  isHero,
  rivalMetadata,
  stack,
  holeCards = null,
  cardsRevealed,
  status = 'active',
  streetContribution = 0,
  isActiveTurn,
  isDealer,
  isOpener,
  declaration,
  isWinner = false,
  isBetweenHands,
  terminology,
  forceExpandDetails = false,
  onBoundaryRebuy,
  onBoundaryCashOut,
}: TableSeatProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const detailsExpanded = forceExpandDetails || localExpanded;
  const detailsId = `sb-seat-details-${playerId}`;

  const stackTotal = chipValue(stack);
  const isTilted = rivalMetadata?.isTilted ?? false;
  const isFolded = status === 'folded';
  const isAllIn = status === 'all-in';
  const hasFooterPills =
    (!isBetweenHands && (streetContribution > 0 || isActiveTurn || isFolded || isAllIn)) ||
    isWinner;

  return (
    <article
      className={[
        'sb-seat',
        isHero ? 'sb-seat--hero' : 'sb-seat--rival',
        isActiveTurn ? 'sb-seat--active' : '',
        isFolded ? 'sb-seat--folded' : '',
        isTilted ? 'sb-seat--tilted' : '',
        isWinner ? 'sb-seat--winner' : '',
        detailsExpanded ? 'sb-seat--expanded' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-seat-index={seatIndex}
      data-player-id={playerId}
      data-rival-style={rivalMetadata?.styleLabel ?? 'hero'}
      data-tilted={isTilted ? 'true' : 'false'}
      aria-label={`Ghế ${seatIndex + 1}: ${displayName}${rivalMetadata ? `, kiểu ${rivalMetadata.styleLabel}` : ''}, stack ${stackTotal} điểm`}
    >
      <div className="sb-seat__top">
        <div className="sb-seat__header">
          <div className="sb-seat__avatar-wrap">
            <RivalAvatar rivalId={rivalMetadata?.rivalId ?? null} isTilted={isTilted} size={36} />
            {isDealer && (
              <span className="sb-badge sb-badge--dealer" title="Dealer">
                D
              </span>
            )}
          </div>
          <div className="sb-seat__identity">
            <div className="sb-seat__name-row">
              <span className="sb-seat__name">{displayName}</span>
              {isOpener && (
                <span className="sb-badge sb-badge--opener" title="Người mở lời ván này">
                  Mở lời
                </span>
              )}
            </div>
            {rivalMetadata !== null ? (
              <div className="sb-seat__style" title={rivalMetadata.styleSummaryVi}>
                <span className="sb-seat__style-label">{rivalMetadata.styleLabel}</span>
                {rivalMetadata.rivalId === 'nong' && isTilted && (
                  <span className="sb-badge sb-badge--tilt" role="status">
                    {rivalMetadata.publicStatusLabelVi}
                  </span>
                )}
              </div>
            ) : (
              <div className="sb-seat__style">
                <span className="sb-seat__style-label">Người chơi chính</span>
              </div>
            )}
          </div>
        </div>

        <div className="sb-seat__quick-meta">
          <span className="sb-seat__stack-total sb-num">{formatNumberVi(stackTotal)}</span>
          {holeCards !== null && !isBetweenHands && (
            <div className="sb-seat__cards">
              <PlayingCard card={holeCards[0]} faceDown={!cardsRevealed} size="sm" />
              <PlayingCard card={holeCards[1]} faceDown={!cardsRevealed} size="sm" />
            </div>
          )}
          <button
            type="button"
            className="sb-seat__detail-toggle"
            aria-expanded={detailsExpanded}
            aria-controls={detailsId}
            aria-label={`${detailsExpanded ? 'Thu gọn' : 'Xem'} chi tiết chip của ${displayName}`}
            onClick={() => setLocalExpanded((prev) => !prev)}
          >
            <span>Chip</span>
            <span aria-hidden="true">{detailsExpanded ? '▴' : '▾'}</span>
          </button>
        </div>
      </div>

      <div
        id={detailsId}
        className={`sb-seat__details-panel${detailsExpanded ? ' is-expanded' : ''}`}
      >
        <div className="sb-seat__chip-pills" aria-label="Cơ cấu chip theo mệnh giá">
          {stackTotal === 0 ? (
            <span className="sb-seat__empty-stack">0 chip</span>
          ) : (
            DENOMINATIONS.map((denom) =>
              stack[denom] > 0 ? (
                <span key={denom} className="sb-chip-pill sb-num">
                  <ChipSvg denomination={denom} size={15} decorative />
                  <span>{stack[denom]}</span>
                </span>
              ) : null,
            )
          )}
        </div>
        {rivalMetadata !== null && (
          <p className="sb-seat__style-summary">{rivalMetadata.styleSummaryVi}</p>
        )}
      </div>

      {hasFooterPills && (
        <div className="sb-seat__footer">
          {streetContribution > 0 && !isBetweenHands && (
            <span className="sb-pill sb-pill--bet sb-num">Góp: {streetContribution}</span>
          )}
          {isActiveTurn && !isBetweenHands && (
            <span className="sb-pill sb-pill--turn">Đang lượt</span>
          )}
          {isFolded && !isBetweenHands && <span className="sb-pill sb-pill--fold">Đã Fold</span>}
          {isAllIn && !isBetweenHands && <span className="sb-pill sb-pill--allin">ALL-IN</span>}
          {isWinner && <span className="sb-pill sb-pill--win">Thắng pot</span>}
        </div>
      )}

      {declaration !== null && !isBetweenHands && (
        <div className="sb-oot-bubble" role="status">
          <strong>Hô sớm:</strong>{' '}
          {formatBettingActionShort(declaration.action, terminology)}
          {chipValue(declaration.reservedChips) > 0 && (
            <span className="sb-num"> · giữ {chipValue(declaration.reservedChips)}</span>
          )}
        </div>
      )}

      {isBetweenHands && (
        <div className="sb-seat__boundary-actions">
          {stackTotal === 0 && onBoundaryRebuy && (
            <button
              type="button"
              className="sb-btn sb-btn--accent sb-btn--xs"
              onClick={() => onBoundaryRebuy(playerId)}
            >
              Rebuy 500
            </button>
          )}
          {onBoundaryCashOut && (
            <button
              type="button"
              className="sb-btn sb-btn--ghost sb-btn--xs"
              onClick={() => onBoundaryCashOut(playerId)}
            >
              Cash out
            </button>
          )}
        </div>
      )}
    </article>
  );
}
