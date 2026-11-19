import { afterEach, describe, expect, it } from 'vitest';
import { CHIP_SET, checkInv1 } from '../../src/engine/chips';
import { createRng } from '../../src/engine/rng';
import { createDeck, formatCard, parseCard, parseCards, shuffledDeck } from '../../src/engine/cards';
afterEach(() => expect(checkInv1([CHIP_SET])).toEqual({ ok: true }));
describe('cards', () => {
  it('round trips all 52 distinct cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(formatCard)).size).toBe(52);
    for (const c of deck) expect(parseCard(formatCard(c))).toEqual(c);
    expect(parseCards(' As\tKd  5c ')).toEqual(['As', 'Kd', '5c'].map(parseCard));
    expect(parseCards(' ')).toEqual([]);
  });
  it('rejects invalid cards', () => {
    for (const value of ['', '10d', 'as', 'AX', '1s', 'As ', 'ss']) expect(() => parseCard(value)).toThrow();
  });
  it('shuffles deterministically', () => {
    expect(shuffledDeck(createRng('seed'))).toEqual(shuffledDeck(createRng('seed')));
    expect(shuffledDeck(createRng('seed'))).not.toEqual(shuffledDeck(createRng('other')));
  });
});
