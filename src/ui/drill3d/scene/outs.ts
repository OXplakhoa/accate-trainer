import { DENOMINATIONS, emptyChips, type ChipCounts, type Denomination } from '../../../engine';
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

export const CHIP_DENOMS: Readonly<Record<Denomination, ChipDenomSpec>> = {
  5: { value: 5, bodyHex: '#b23b32', stripeHex: '#f5eee2', accentHex: '#faf3e6' },
  10: { value: 10, bodyHex: '#206785', stripeHex: '#edc28d', accentHex: '#f2f7f9' },
  50: { value: 50, bodyHex: '#b87a24', stripeHex: '#194a38', accentHex: '#fcf5e6' },
  100: { value: 100, bodyHex: '#2c2638', stripeHex: '#edc28d', accentHex: '#f8f0df' },
};

export interface ChipStackItem {
  readonly denom: ChipDenomSpec;
  readonly count: number;
}

export const CHIP_RADIUS = 0.072;

/** Centre all columns, including an incomplete final row, on the anchor. */
export function layoutChipColumns(count: number): readonly { x: number; z: number }[] {
  if (count <= 0) return [];
  const cols = Math.min(5, count);
  const spacing = 0.16;
  const offsets = Array.from({ length: count }, (_, i) => ({
    x: (i % cols - (cols - 1) / 2) * spacing,
    z: Math.floor(i / cols) * spacing,
  }));
  const meanX = offsets.reduce((sum, offset) => sum + offset.x, 0) / count;
  const meanZ = offsets.reduce((sum, offset) => sum + offset.z, 0) / count;
  return offsets.map(({ x, z }) => ({ x: x - meanX, z: z - meanZ }));
}

/** Total physical chip count across all valid denominations. */
export function countTotalChips(chips: ChipCounts): number {
  let total = 0;
  for (const d of DENOMINATIONS) {
    total += chips[d];
  }
  return total;
}

/** Split physical counts into columns without hiding chips. */
export function buildChipStacks(chips: ChipCounts, maxPerColumn = 10): readonly ChipStackItem[] {
  const cap = Math.max(1, Math.floor(maxPerColumn));
  const stacks: ChipStackItem[] = [];
  for (const d of [...DENOMINATIONS].reverse()) {
    for (let remaining = chips[d]; remaining > 0; remaining -= cap) {
      stacks.push({ denom: CHIP_DENOMS[d], count: Math.min(cap, remaining) });
    }
  }
  return stacks;
}

export function chipsForAmount(amount: number): ChipCounts {
  let remaining = Math.max(0, Math.floor(amount));
  const chips = { ...emptyChips() };
  for (const d of [...DENOMINATIONS].reverse()) {
    chips[d] = Math.floor(remaining / d);
    remaining -= chips[d] * d;
  }
  return chips;
}

export function buildChipStacksForAmount(amount: number): readonly ChipStackItem[] {
  return buildChipStacks(chipsForAmount(amount));
}
