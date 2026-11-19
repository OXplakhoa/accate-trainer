import {
  chipValue,
  DENOMINATIONS,
  type BettingAction,
  type Card,
  type ChipCounts,
  type Denomination,
  type HandState,
  type RivalId,
  type Suit,
} from '../../engine';
import type { DrillSpot } from '../../engine/drill';

const RANK_LABELS: Readonly<Record<number, string>> = Object.freeze({
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
});

const SUIT_GLYPHS: Readonly<Record<Suit, string>> = Object.freeze({
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
});

const SUIT_NAMES_VI: Readonly<Record<Suit, string>> = Object.freeze({
  s: 'Bích',
  h: 'Cơ',
  d: 'Rô',
  c: 'Chuồn',
});

const SUIT_COLORS: Readonly<Record<Suit, string>> = Object.freeze({
  s: '#1b2422',
  h: '#b52828',
  d: '#1d569e',
  c: '#186337',
});

export function CardView(props: {
  readonly card?: Card;
  readonly faceDown?: boolean;
  readonly small?: boolean;
}) {
  const sizeClass = props.small ? ' drill-playing-card-sm' : '';
  if (props.faceDown || props.card === undefined) {
    return (
      <span
        className={`drill-playing-card drill-playing-card-back${sizeClass}`}
        role="img"
        aria-label="Lá bài úp"
      />
    );
  }

  const rankStr = RANK_LABELS[props.card.rank] ?? String(props.card.rank);
  const suitGlyph = SUIT_GLYPHS[props.card.suit];
  const suitNameVi = SUIT_NAMES_VI[props.card.suit];
  const color = SUIT_COLORS[props.card.suit];

  return (
    <span
      className={`drill-playing-card${sizeClass}`}
      style={{ color }}
      role="img"
      aria-label={`Lá ${rankStr} ${suitNameVi}`}
    >
      <span className="drill-card-rank">{rankStr}</span>
      <span className="drill-card-suit" aria-hidden="true">
        {suitGlyph}
      </span>
    </span>
  );
}

const CHIP_STYLES: Readonly<
  Record<
    Denomination,
    {
      readonly fill: string;
      readonly rim: string;
      readonly dash: string;
      readonly text: string;
      readonly nameVi: string;
    }
  >
> = Object.freeze({
  5: {
    fill: '#b9382c',
    rim: '#f7d8d4',
    dash: '4 3',
    text: '#ffffff',
    nameVi: 'Chip 5 đỏ',
  },
  10: {
    fill: '#2466a8',
    rim: '#d7e9fc',
    dash: '6 2',
    text: '#ffffff',
    nameVi: 'Chip 10 lam',
  },
  50: {
    fill: '#2b7a4b',
    rim: '#f2d399',
    dash: '3 2 1 2',
    text: '#ffffff',
    nameVi: 'Chip 50 lục',
  },
  100: {
    fill: '#232026',
    rim: '#edc28d',
    dash: '5 2 2 2',
    text: '#f5ce9b',
    nameVi: 'Chip 100 đen viền vàng',
  },
});

export function ChipToken(props: {
  readonly denomination: Denomination;
  readonly count?: number;
  readonly size?: number;
}) {
  const size = props.size ?? 32;
  const st = CHIP_STYLES[props.denomination];
  const label =
    props.count !== undefined
      ? `${props.count} × ${st.nameVi} (${props.count * props.denomination} điểm)`
      : `${st.nameVi} (${props.denomination} điểm)`;

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      role="img"
      aria-label={label}
    >
      <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="16" fill={st.fill} stroke={st.rim} strokeWidth="2" />
        <circle
          cx="18"
          cy="18"
          r="13.2"
          fill="none"
          stroke={st.rim}
          strokeWidth="2.4"
          strokeDasharray={st.dash}
        />
        <circle cx="18" cy="18" r="9.8" fill={st.fill} stroke={st.rim} strokeWidth="1" />
        <text
          x="18"
          y="21.5"
          textAnchor="middle"
          fill={st.text}
          fontSize={props.denomination === 100 ? '9.5' : '11'}
          fontWeight="800"
        >
          {props.denomination}
        </text>
      </svg>
      {props.count !== undefined ? (
        <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>×{props.count}</span>
      ) : null}
    </span>
  );
}

export function ChipStackInline(props: { readonly chips: ChipCounts; readonly compact?: boolean }) {
  const nonZero = DENOMINATIONS.filter((d) => props.chips[d] > 0);
  if (nonZero.length === 0) {
    return <span style={{ fontSize: '0.76rem', color: 'var(--drill-text-muted)' }}>0 chip</span>;
  }
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {nonZero.map((d) => (
        <ChipToken
          key={d}
          denomination={d}
          count={props.chips[d]}
          size={props.compact ? 22 : 26}
        />
      ))}
    </span>
  );
}

const RIVAL_COLORS: Readonly<Record<RivalId, { readonly bg: string; readonly ring: string; readonly glyph: string }>> =
  Object.freeze({
    da: { bg: '#3c4b52', ring: '#9fb1b8', glyph: '🪨' },
    ca: { bg: '#22596e', ring: '#79c9e8', glyph: '🐟' },
    cao: { bg: '#6e3b1e', ring: '#f0a36a', glyph: '🦊' },
    soi: { bg: '#3e3559', ring: '#b8a7f2', glyph: '🐺' },
    dien: { bg: '#732436', ring: '#ff859d', glyph: '⚡' },
    'dai-gia': { bg: '#5e4b1c', ring: '#f5d276', glyph: '🐋' },
    tho: { bg: '#2f5744', ring: '#96dfb9', glyph: '🐇' },
    bay: { bg: '#422c4f', ring: '#d89df5', glyph: '🕸️' },
    nong: { bg: '#5a3228', ring: '#f29f85', glyph: '🔥' },
  });

export function RivalAvatar(props: {
  readonly rivalId: RivalId;
  readonly isTilted?: boolean;
  readonly size?: number;
}) {
  const size = props.size ?? 34;
  const theme = RIVAL_COLORS[props.rivalId];
  const bg = props.isTilted ? '#8f1d1d' : theme.bg;
  const ring = props.isTilted ? '#ff7366' : theme.ring;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      aria-label={`Avatar ${props.rivalId}${props.isTilted ? ' đang tilt' : ''}`}
      role="img"
    >
      <circle cx="18" cy="18" r="16" fill={bg} stroke={ring} strokeWidth="2.2" />
      {props.isTilted ? (
        <>
          <path d="M10 13 L16 16" stroke="#ffd2cc" strokeWidth="2" strokeLinecap="round" />
          <path d="M26 13 L20 16" stroke="#ffd2cc" strokeWidth="2" strokeLinecap="round" />
          <circle cx="13.5" cy="17.5" r="1.6" fill="#ffffff" />
          <circle cx="22.5" cy="17.5" r="1.6" fill="#ffffff" />
          <path
            d="M12.5 25 Q18 20.5 23.5 25"
            fill="none"
            stroke="#ffd2cc"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      ) : (
        <text x="18" y="22.5" textAnchor="middle" fontSize="15">
          {theme.glyph}
        </text>
      )}
    </svg>
  );
}

function formatOutOfTurnActionVi(action: BettingAction): string {
  switch (action.type) {
    case 'check':
      return 'Hô sớm: Check';
    case 'call':
      return `Hô sớm: Call ${chipValue(action.chips)}`;
    case 'bet':
      return `Hô sớm: Bet ${action.amount}`;
    case 'raise':
      return `Hô sớm: Raise lên ${action.raiseTo}`;
    case 'fold':
      return 'Hô sớm: Fold';
  }
}

export function TableSnapshotView(props: {
  readonly spot: DrillSpot;
  readonly currentHandState: HandState;
  readonly showShowdownCards: boolean;
}) {
  const { spot, currentHandState, showShowdownCards } = props;
  const { snapshot, solution } = spot;

  // Publicly revealed board cards: during decision time use snapshot.board; after completion use completedHandState.board
  const visibleBoard = showShowdownCards ? currentHandState.board : snapshot.board;

  const revealedOpponentIds = new Set<string>();
  if (showShowdownCards && currentHandState.outcome?.kind === 'showdown') {
    for (const potAward of currentHandState.outcome.resolution.potAwards) {
      for (const pid of potAward.eligiblePlayerIds) {
        revealedOpponentIds.add(pid);
      }
    }
  }

  return (
    <section className="drill-felt-panel" aria-label="Bàn Accate mô phỏng">
      <div className="drill-spot-header">
        <div>
          <h2 className="drill-spot-title">{spot.titleVi}</h2>
          <p className="drill-spot-prompt">{spot.promptVi}</p>
        </div>
        <div className="drill-badges-row">
          <span className="drill-badge drill-badge-accent">
            Street: {snapshot.street.toUpperCase()}
          </span>
          <span className="drill-badge">Cap street: {snapshot.streetCap}</span>
          <span className="drill-badge">Mở lời ván: {currentHandState.openerPlayerId}</span>
          <span className="drill-badge">{snapshot.position.label}</span>
          <span className="drill-badge">
            Board: {solution.boardTexture.labelVi}
          </span>
        </div>
      </div>

      {/* Board & Pot Center */}
      <div className="drill-board-zone">
        <div>
          <div style={{ fontSize: '0.78rem', color: 'var(--drill-text-muted)', marginBottom: 6 }}>
            Lá chung đã lật ({visibleBoard.length} lá) · Còn {solution.unseenCards} lá chưa biết
          </div>
          <div className="drill-cards-row">
            {visibleBoard.length > 0 ? (
              visibleBoard.map((card, idx) => <CardView key={`${card.rank}-${card.suit}-${idx}`} card={card} />)
            ) : (
              <span style={{ fontSize: '0.85rem', color: 'var(--drill-text-muted)' }}>
                Chưa lật Flop (Vòng Preflop)
              </span>
            )}
          </div>
        </div>

        <div className="drill-pot-box">
          <div className="drill-pot-main">
            Pot: {showShowdownCards ? chipValue(currentHandState.pot) : snapshot.potBeforeCall} điểm
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
            Mức cược hiện hành: <strong>{snapshot.currentBet}</strong> · Cần Call:{' '}
            <strong>{snapshot.callAmount}</strong> ({solution.potOdds.potToCallLabel})
          </div>
          <ChipStackInline chips={currentHandState.pot} compact />
          {solution.perPotEquity.length > 1 ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--drill-accent)', marginTop: 2 }}>
              {solution.perPotEquity
                .map((p) => `${p.labelVi}: ${p.potBeforeCall} (+${p.heroAddedAmount})`)
                .join(' · ')}
            </div>
          ) : null}
        </div>
      </div>

      {/* Seats Grid (Rivals + Hero) */}
      <div className="drill-seats-grid" role="list" aria-label="Danh sách ghế ngồi trên bàn">
        {currentHandState.seats.map((seat) => {
          const isHero = seat.playerId === spot.heroId;
          const isTurn = !showShowdownCards && currentHandState.activePlayerId === seat.playerId;
          const isDealer = seat.seatIndex === currentHandState.dealerSeatIndex;
          const isOpener = seat.playerId === currentHandState.openerPlayerId;
          const rivalMeta = !isHero ? spot.rivalSeats[seat.playerId] : undefined;
          const rivalId = !isHero ? (spot.seatRivalIds[seat.playerId] ?? 'cao') : undefined;
          const isTilted = rivalMeta?.isTilted ?? false;
          const canShowCards =
            isHero || (showShowdownCards && seat.status !== 'folded' && revealedOpponentIds.has(seat.playerId));

          const cardClasses = [
            'drill-seat-card',
            isTurn ? 'drill-seat-card-active' : '',
            seat.status === 'folded' ? 'drill-seat-card-folded' : '',
            isTilted ? 'drill-seat-card-tilted' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div
              key={seat.playerId}
              className={cardClasses}
              role="listitem"
              aria-label={
                isHero
                  ? `Ghế ${seat.playerId} (Bạn — Hero)`
                  : `Ghế ${seat.playerId}: ${rivalMeta?.name ?? seat.playerId} (${rivalMeta?.styleLabel ?? ''})`
              }
            >
              <div className="drill-seat-top">
                {!isHero && rivalId !== undefined ? (
                  <RivalAvatar rivalId={rivalId} isTilted={isTilted} size={34} />
                ) : (
                  <span
                    className="drill-badge drill-badge-accent"
                    style={{ fontWeight: 800, padding: '4px 8px' }}
                  >
                    HERO
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="drill-seat-name">
                    Ghế {seat.playerId}: {isHero ? 'Bạn (Hero)' : (rivalMeta?.name ?? seat.playerId)}
                    {isDealer ? ' (D)' : ''}
                    {isOpener ? ' ★' : ''}
                  </div>
                  {!isHero && rivalMeta !== undefined ? (
                    <div className="drill-seat-style">{rivalMeta.styleLabel}</div>
                  ) : (
                    <div className="drill-seat-style">Người chơi</div>
                  )}
                </div>
              </div>

              {isTilted && rivalMeta !== undefined ? (
                <div className="drill-badge drill-badge-tilt">
                  🔥 {rivalMeta.publicStatusLabelVi}
                </div>
              ) : null}

              <div className="drill-seat-meta">
                <span>Stack: <strong>{chipValue(seat.stack)}</strong></span>
                <span>Góp street: <strong>{seat.streetContribution}</strong></span>
                <span>
                  {seat.status === 'folded'
                    ? 'Đã Fold'
                    : seat.status === 'all-in'
                      ? 'ALL-IN'
                      : isTurn
                        ? 'Đang tới lượt'
                        : 'Còn trong ván'}
                </span>
              </div>

              {seat.declaration !== null ? (
                <div className="drill-oot-bubble">
                  💬 {formatOutOfTurnActionVi(seat.declaration.action)} (đẩy{' '}
                  {chipValue(seat.declaration.reservedChips)} ra trước mặt)
                </div>
              ) : null}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div className="drill-cards-row">
                  <CardView card={canShowCards ? seat.holeCards[0] : undefined} faceDown={!canShowCards} small />
                  <CardView card={canShowCards ? seat.holeCards[1] : undefined} faceDown={!canShowCards} small />
                </div>
                <ChipStackInline chips={seat.stack} compact />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
