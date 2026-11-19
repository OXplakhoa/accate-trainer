import type { Card, Suit } from './cards';

export type HandCategory = 'high-card' | 'pair' | 'two-pair' | 'three-of-a-kind' | 'straight' | 'flush' | 'full-house' | 'four-of-a-kind' | 'straight-flush';
export interface HandValue { readonly category: HandCategory; readonly ranks: readonly number[]; readonly best5: readonly Card[]; }
const categories: HandCategory[] = ['high-card', 'pair', 'two-pair', 'three-of-a-kind', 'straight', 'flush', 'full-house', 'four-of-a-kind', 'straight-flush'];
export function compareHands(a: HandValue, b: HandValue): -1 | 0 | 1 {
  const categoryDiff = categories.indexOf(a.category) - categories.indexOf(b.category);
  if (categoryDiff) return categoryDiff > 0 ? 1 : -1;
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
    const diff = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}
function straightHigh(mask: number): number {
  if (mask & (1 << 14)) mask |= 1 << 1;
  for (let high = 14; high >= 5; high--) if (((mask >> (high - 4)) & 31) === 31) return high;
  return 0;
}
export function evaluateHand(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) throw new Error('Expected five to seven cards');
  const groups: Card[][] = Array.from({ length: 15 }, () => []);
  const suits: Record<Suit, Card[]> = { s: [], h: [], d: [], c: [] };
  let mask = 0;
  for (const card of cards) {
    if (!Number.isInteger(card.rank) || card.rank < 2 || card.rank > 14 || !Object.hasOwn(suits, card.suit)) throw new Error('Invalid card');
    const group = groups[card.rank]!;
    if (group.some(c => c.suit === card.suit)) throw new Error('Duplicate card');
    group.push(card); suits[card.suit].push(card); mask |= 1 << card.rank;
  }
  const flush = Object.values(suits).find(s => s.length >= 5);
  const straight = straightHigh(mask);
  const flushStraight = flush ? straightHigh(flush.reduce((m, c) => m | (1 << c.rank), 0)) : 0;
  const descending: number[] = [];
  const pairs: number[] = [];
  const trips: number[] = [];
  let quad = 0;
  for (let rank = 14; rank >= 2; rank--) {
    const count = groups[rank]!.length;
    if (count) descending.push(rank);
    if (count >= 2) pairs.push(rank);
    if (count >= 3) trips.push(rank);
    if (count === 4) quad = rank;
  }
  const straightCards = (high: number, pool: readonly Card[]): Card[] => {
    const result: Card[] = [];
    for (let rank = high; rank > high - 5; rank--) result.push(pool.find(c => c.rank === (rank === 1 ? 14 : rank))!);
    return result;
  };
  const fromRanks = (rs: readonly number[]): Card[] => rs.flatMap(rank => groups[rank]!);
  if (flushStraight) return { category: 'straight-flush', ranks: [flushStraight], best5: straightCards(flushStraight, flush!) };
  if (quad) {
    const kicker = descending.find(r => r !== quad)!;
    return { category: 'four-of-a-kind', ranks: [quad, kicker], best5: [...groups[quad]!, groups[kicker]![0]!] };
  }
  if (trips.length && pairs.some(r => r !== trips[0])) {
    const t = trips[0]!, p = pairs.find(r => r !== t)!;
    return { category: 'full-house', ranks: [t, p], best5: [...groups[t]!.slice(0, 3), ...groups[p]!.slice(0, 2)] };
  }
  if (flush) {
    const best5 = [...flush].sort((a, b) => b.rank - a.rank).slice(0, 5);
    return { category: 'flush', ranks: best5.map(c => c.rank), best5 };
  }
  if (straight) return { category: 'straight', ranks: [straight], best5: straightCards(straight, cards) };
  if (trips.length) {
    const t = trips[0]!, kickers = descending.filter(r => r !== t).slice(0, 2);
    return { category: 'three-of-a-kind', ranks: [t, ...kickers], best5: [...groups[t]!.slice(0, 3), ...kickers.map(r => groups[r]![0]!)] };
  }
  if (pairs.length >= 2) {
    const [a, b] = pairs as [number, number];
    const kicker = descending.find(r => r !== a && r !== b)!;
    return { category: 'two-pair', ranks: [a, b, kicker], best5: [...groups[a]!.slice(0, 2), ...groups[b]!.slice(0, 2), groups[kicker]![0]!] };
  }
  if (pairs.length) {
    const p = pairs[0]!, kickers = descending.filter(r => r !== p).slice(0, 3);
    return { category: 'pair', ranks: [p, ...kickers], best5: [...groups[p]!.slice(0, 2), ...kickers.map(r => groups[r]![0]!)] };
  }
  const ranks = descending.slice(0, 5);
  return { category: 'high-card', ranks, best5: fromRanks(ranks) };
}
