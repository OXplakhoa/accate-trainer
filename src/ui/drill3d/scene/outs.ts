import type { DemoSpot } from '../contract';

export type CardSuit = '♥' | '♦' | '♣' | '♠';

export interface ParsedCard {
  readonly raw: string;
  readonly rank: string;
  readonly suit: CardSuit;
  readonly isRed: boolean;
  readonly isHeart: boolean;
  readonly accessibleName: string;
}

const HEART_RANKS: readonly string[] = [
  'A',
  'K',
  'Q',
  'J',
  '10',
  '9',
  '8',
  '7',
  '6',
  '5',
  '4',
  '3',
  '2',
];

const SUIT_NAMES_VI: Record<CardSuit, string> = {
  '♥': 'cơ',
  '♦': 'rô',
  '♣': 'tép',
  '♠': 'bích',
};

const RANK_NAMES_VI: Record<string, string> = {
  A: 'Át',
  K: 'K',
  Q: 'Q',
  J: 'J',
  '10': '10',
  '9': '9',
  '8': '8',
  '7': '7',
  '6': '6',
  '5': '5',
  '4': '4',
  '3': '3',
  '2': '2',
};

export function parseCard(card: string): ParsedCard {
  const trimmed = card.trim();
  const lastChar = trimmed.slice(-1);
  const suit: CardSuit =
    lastChar === '♥' || lastChar === '♦' || lastChar === '♣' || lastChar === '♠'
      ? lastChar
      : '♠';
  const rank = trimmed.slice(0, Math.max(1, trimmed.length - 1)) || '?';
  const rankLabel = RANK_NAMES_VI[rank] ?? rank;
  return {
    raw: trimmed,
    rank,
    suit,
    isRed: suit === '♥' || suit === '♦',
    isHeart: suit === '♥',
    accessibleName: `${rankLabel} ${SUIT_NAMES_VI[suit]}`,
  };
}

/**
 * Returns every remaining unseen heart card from a standard 52-card deck
 * that has NOT appeared in Hero's hole cards or the Turn board.
 */
export function getUnseenHearts(spot: DemoSpot): readonly string[] {
  const seen = new Set<string>([...spot.heroCards, ...spot.board]);
  const unseen: string[] = [];
  for (const rank of HEART_RANKS) {
    const candidate = `${rank}♥`;
    if (!seen.has(candidate)) {
      unseen.push(candidate);
    }
  }
  return unseen;
}

export interface ChipDenomSpec {
  readonly value: number;
  readonly bodyHex: string;
  readonly stripeHex: string;
  readonly accentHex: string;
}

const CHIP_DENOMS: readonly ChipDenomSpec[] = [
  { value: 50, bodyHex: '#C95849', stripeHex: '#F5EAD8', accentHex: '#E9C890' },
  { value: 25, bodyHex: '#2E6A5E', stripeHex: '#F3E8D4', accentHex: '#A7D3C7' },
  { value: 10, bodyHex: '#4F9DD3', stripeHex: '#F7EFE2', accentHex: '#D8ECFA' },
  { value: 5, bodyHex: '#D89A46', stripeHex: '#533C31', accentHex: '#F7E7CA' },
];

export interface ChipStackItem {
  readonly denom: ChipDenomSpec;
  readonly count: number;
}

export function buildChipStacksForAmount(amount: number): readonly ChipStackItem[] {
  let remaining = Math.max(0, Math.round(amount));
  const stacks: ChipStackItem[] = [];

  for (const denom of CHIP_DENOMS) {
    if (remaining <= 0) {
      break;
    }
    // Use 25s or 10s so stacks feel tactile and visually rich (e.g. 50 -> 2x25 or 1x50 + 5x10)
    const count = Math.floor(remaining / denom.value);
    if (count > 0) {
      stacks.push({ denom, count });
      remaining -= count * denom.value;
    }
  }

  // Split very sparse 1-chip stacks (like exact 50) into tactile multi-chip stacks
  if (stacks.length === 1 && stacks[0] && stacks[0].count === 1 && stacks[0].denom.value === 50) {
    const twentyFive = CHIP_DENOMS[1];
    const ten = CHIP_DENOMS[2];
    if (twentyFive && ten) {
      return [
        { denom: twentyFive, count: 1 },
        { denom: ten, count: 2 },
        { denom: CHIP_DENOMS[3] ?? ten, count: 1 },
      ];
    }
  }

  return stacks;
}
