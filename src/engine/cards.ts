import type { Rng } from './rng';

export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export interface Card { readonly rank: Rank; readonly suit: Suit; }
const ranks = '23456789TJQKA';
const suits = 'shdc';
export function parseCard(s: string): Card {
  if (s.length !== 2 || !ranks.includes(s[0]!) || !suits.includes(s[1]!)) throw new Error('Invalid card');
  return Object.freeze({ rank: (ranks.indexOf(s[0]!) + 2) as Rank, suit: s[1] as Suit });
}
export function formatCard(c: Card): string { return ranks[c.rank - 2]! + c.suit; }
export function parseCards(s: string): Card[] { return s.trim() ? s.trim().split(/\s+/).map(parseCard) : []; }
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of suits) for (const rank of ranks) deck.push(parseCard(rank + suit));
  return deck;
}
export function shuffledDeck(rng: Rng): Card[] { return rng.shuffle(createDeck()); }
