import type { Card } from './cards';
import type { Rng } from './rng';

export function baiCaoPoints(cards: readonly Card[]): number {
  if (cards.length !== 3) throw new Error('Expected three cards');
  return cards.reduce((sum, c) => sum + (c.rank === 14 ? 1 : c.rank >= 10 ? 0 : c.rank), 0) % 10;
}
export function isBaTay(cards: readonly Card[]): boolean {
  if (cards.length !== 3) throw new Error('Expected three cards');
  return cards.every(c => c.rank >= 11 && c.rank <= 13);
}
export function compareBaiCao(a: readonly Card[], b: readonly Card[]): -1 | 0 | 1 {
  const av = isBaTay(a) ? 10 : baiCaoPoints(a);
  const bv = isBaTay(b) ? 10 : baiCaoPoints(b);
  return av > bv ? 1 : av < bv ? -1 : 0;
}
export interface BaiCaoDraw { readonly playerId: string; readonly cards: readonly Card[]; readonly points: number; readonly baTay: boolean; }
export interface BaiCaoResult { readonly winnerId: string; readonly rounds: readonly (readonly BaiCaoDraw[])[]; }
export interface BaiCaoDeckState {
  readonly source: readonly Card[];
  readonly index: number;
  readonly drawn: readonly Card[];
}

function cardKey(card: Card): string {
  return `${card.rank}:${card.suit}`;
}

export function createBaiCaoDeck(undealt: readonly Card[]): BaiCaoDeckState {
  if (new Set(undealt.map(cardKey)).size !== undealt.length) throw new Error('Expected distinct cards');
  if (undealt.length < 3) throw new Error('At least three distinct cards are required');
  return { source: [...undealt], index: 0, drawn: [] };
}

export function resolveBaiCaoWithDeck(
  contenders: readonly string[],
  deckState: BaiCaoDeckState,
  rng: Rng,
): { readonly result: BaiCaoResult; readonly nextDeck: BaiCaoDeckState } {
  if (contenders.length < 2 || new Set(contenders).size !== contenders.length) throw new Error('Expected distinct contenders');
  if (!Number.isInteger(deckState.index) || deckState.index < 0 || deckState.index > deckState.source.length) {
    throw new RangeError('Invalid bai cao deck index');
  }
  const activePool = [...deckState.source.slice(deckState.index), ...deckState.drawn];
  if (new Set(activePool.map(cardKey)).size !== activePool.length) throw new Error('Expected distinct cards');
  if (activePool.length < 3) throw new Error('At least three distinct cards are required');
  let players = [...contenders];
  let source = [...deckState.source];
  let index = deckState.index;
  let drawn = [...deckState.drawn];
  const rounds: BaiCaoDraw[][] = [];
  while (players.length > 1) {
    // Protect against degenerate sources that can tie indefinitely.
    if (rounds.length >= 1000) throw new Error('Bai cao unresolved after 1000 rounds');
    const round: BaiCaoDraw[] = [];
    for (const playerId of players) {
      const cards: Card[] = [];
      for (let i = 0; i < 3; i++) {
        if (index === source.length) {
          // Recycle completed hands while keeping the current hand out of the source.
          source = rng.shuffle([...source.slice(index), ...drawn]); index = 0; drawn = [];
        }
        const card = source[index++]!;
        cards.push(card);
      }
      round.push({ playerId, cards, points: baiCaoPoints(cards), baTay: isBaTay(cards) });
      drawn.push(...cards);
    }
    rounds.push(round);
    let best = round[0]!;
    for (const draw of round) if (compareBaiCao(draw.cards, best.cards) > 0) best = draw;
    players = round.filter(draw => compareBaiCao(draw.cards, best.cards) === 0).map(draw => draw.playerId);
  }
  return {
    result: { winnerId: players[0]!, rounds },
    nextDeck: { source, index, drawn },
  };
}

export function resolveBaiCao(contenders: readonly string[], undealt: readonly Card[], rng: Rng): BaiCaoResult {
  if (contenders.length < 2 || new Set(contenders).size !== contenders.length) throw new Error('Expected distinct contenders');
  return resolveBaiCaoWithDeck(contenders, createBaiCaoDeck(undealt), rng).result;
}
