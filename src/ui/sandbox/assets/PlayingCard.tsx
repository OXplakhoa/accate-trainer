import type { Card } from '../../../engine';
import { formatCardAriaVi, formatCardRank, isRedSuit, suitSymbol } from '../format';

export interface PlayingCardProps {
  readonly card?: Card | null;
  readonly faceDown?: boolean;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly highlighted?: boolean;
  readonly animated?: boolean;
}

export function PlayingCard({
  card = null,
  faceDown = false,
  size = 'md',
  highlighted = false,
  animated = false,
}: PlayingCardProps) {
  const showBack = faceDown || card === null;

  if (showBack) {
    return (
      <div
        className={`sb-card sb-card--back sb-card--${size}${animated ? ' sb-card--animate' : ''}`}
        role="img"
        aria-label="Lá bài úp"
      >
        <div className="sb-card__back-pattern" aria-hidden="true">
          <span className="sb-card__back-emblem">♦</span>
        </div>
      </div>
    );
  }

  const red = isRedSuit(card.suit);
  const rank = formatCardRank(card.rank);
  const symbol = suitSymbol(card.suit);

  return (
    <div
      className={`sb-card sb-card--face sb-card--${size} ${red ? 'sb-card--red' : 'sb-card--black'}${highlighted ? ' sb-card--highlight' : ''}${animated ? ' sb-card--animate' : ''}`}
      role="img"
      aria-label={formatCardAriaVi(card)}
    >
      <span className="sb-card__corner sb-card__corner--top" aria-hidden="true">
        <span className="sb-card__rank">{rank}</span>
        <span className="sb-card__suit">{symbol}</span>
      </span>
      <span className="sb-card__center" aria-hidden="true">
        {symbol}
      </span>
      <span className="sb-card__corner sb-card__corner--bottom" aria-hidden="true">
        <span className="sb-card__rank">{rank}</span>
        <span className="sb-card__suit">{symbol}</span>
      </span>
    </div>
  );
}
