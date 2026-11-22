import type { SceneTableSnapshot } from '../contract';

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

const ASCII_SUIT_MAP: Record<string, CardSuit> = {
  h: '♥',
  H: '♥',
  d: '♦',
  D: '♦',
  c: '♣',
  C: '♣',
  s: '♠',
  S: '♠',
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
      : (ASCII_SUIT_MAP[lastChar] ?? '♠');
  const rawRank = trimmed.slice(0, Math.max(1, trimmed.length - 1)) || '?';
  const rank = rawRank === 'T' || rawRank === 't' ? '10' : rawRank;
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
 * that has NOT appeared in Hero's hole cards or the board.
 */
export function getUnseenHearts(spot: SceneTableSnapshot): readonly string[] {
  const seen = new Set<string>(
    [...spot.heroCards, ...spot.board].map((card) => {
      const parsed = parseCard(card);
      return `${parsed.rank}${parsed.suit}`;
    }),
  );
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
  { value: 500, bodyHex: '#6F4C7A', stripeHex: '#F7EFE2', accentHex: '#E5D4EC' },
  { value: 100, bodyHex: '#3B3635', stripeHex: '#E8C596', accentHex: '#D8C7B4' },
  { value: 50, bodyHex: '#C95849', stripeHex: '#F5EAD8', accentHex: '#E9C890' },
  { value: 25, bodyHex: '#2E6A5E', stripeHex: '#F3E8D4', accentHex: '#A7D3C7' },
  { value: 10, bodyHex: '#4F9DD3', stripeHex: '#F7EFE2', accentHex: '#D8ECFA' },
  { value: 5, bodyHex: '#D89A46', stripeHex: '#533C31', accentHex: '#F7E7CA' },
  { value: 1, bodyHex: '#E8DEC9', stripeHex: '#7A5B47', accentHex: '#CBB89D' },
];

const MAX_CHIPS_PER_STACK = 10;

export interface ChipStackItem {
  readonly denom: ChipDenomSpec;
  readonly count: number;
}

export function buildChipStacksForAmount(amount: number): readonly ChipStackItem[] {
  let remaining = Math.max(0, Math.round(amount));
  if (remaining <= 0) {
    return [];
  }

  // Keep exact tactile Drill breakdown for 100 (2x50) and 50 (1x25 + 2x10 + 1x5)
  if (remaining === 100) {
    const fifty = CHIP_DENOMS.find((d) => d.value === 50);
    if (fifty) {
      return [{ denom: fifty, count: 2 }];
    }
  }
  if (remaining === 50) {
    const twentyFive = CHIP_DENOMS.find((d) => d.value === 25);
    const ten = CHIP_DENOMS.find((d) => d.value === 10);
    const five = CHIP_DENOMS.find((d) => d.value === 5);
    if (twentyFive && ten && five) {
      return [
        { denom: twentyFive, count: 1 },
        { denom: ten, count: 2 },
        { denom: five, count: 1 },
      ];
    }
  }

  const stacks: ChipStackItem[] = [];

  for (const denom of CHIP_DENOMS) {
    if (remaining <= 0) {
      break;
    }
    const rawCount = Math.floor(remaining / denom.value);
    if (rawCount > 0) {
      stacks.push({ denom, count: Math.min(MAX_CHIPS_PER_STACK, rawCount) });
      remaining -= rawCount * denom.value;
    }
  }

  return stacks;
}
