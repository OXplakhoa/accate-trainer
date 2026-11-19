import { afterEach, describe, expect, it } from 'vitest';
import { CHIP_SET, checkInv1 } from '../../src/engine/chips';
import { createDeck, formatCard, parseCards, type Card } from '../../src/engine/cards';
import { createRng } from '../../src/engine/rng';
import {
  baiCaoPoints,
  compareBaiCao,
  createBaiCaoDeck,
  isBaTay,
  resolveBaiCao,
  resolveBaiCaoWithDeck,
} from '../../src/engine/baiCao';
afterEach(() => expect(checkInv1([CHIP_SET])).toEqual({ ok: true }));
const resolve = (players: string[], cards: string) => resolveBaiCao(players, parseCards(cards), createRng('fixed').fork('baicao'));
const checkHands = (rounds: readonly (readonly { readonly cards: readonly Card[] }[])[]) => {
  for (const round of rounds) for (const draw of round) {
    expect(draw.cards).toHaveLength(3);
    expect(new Set(draw.cards.map(formatCard)).size).toBe(3);
    expect(checkInv1([CHIP_SET])).toEqual({ ok: true });
  }
};
describe('bai cao', () => {
  it('S4: ten is not a face card', () => {
    expect(baiCaoPoints(parseCards('Td Jc Qh'))).toBe(0); expect(isBaTay(parseCards('Td Jc Qh'))).toBe(false);
    expect(isBaTay(parseCards('Jc Qd Kh'))).toBe(true);
    expect(baiCaoPoints(parseCards('4c 5d Kh'))).toBe(9); expect(baiCaoPoints(parseCards('Ac 9d Ks'))).toBe(0);
    expect(compareBaiCao(parseCards('Jc Qd Kh'), parseCards('4c 5d Kh'))).toBe(1);
    expect(compareBaiCao(parseCards('Jc Qd Kh'), parseCards('Jh Qs Kc'))).toBe(0);
    expect(() => baiCaoPoints(parseCards('Ac'))).toThrow();
  });
  it('S1: ba tay beats nine points', () => {
    const result = resolve(['B','C'], '4c 5d Kh Qc Jd Ks');
    expect(result.winnerId).toBe('C'); expect(result.rounds[0]!.map(d => [d.points,d.baTay])).toEqual([[9,false],[0,true]]);
  });
  it('S2: tied seven point hands draw again', () => {
    const result = resolve(['B','C'], '2c 5d Kh 3c 4d Ks 4c 5h Kd 2d 3h Kc');
    expect(result.rounds.map(r => r.map(d => d.playerId))).toEqual([['B','C'],['B','C']]); expect(result.winnerId).toBe('B');
  });
  it('S3: only the highest tied players continue', () => {
    const result = resolve(['A','B','C'], '2c 5d Kh 3c 4d Ks 2h 3d Kc 4c 5h Kd 2d 3h Qc');
    expect(result.rounds.map(r => r.map(d => d.playerId))).toEqual([['A','B','C'],['A','B']]); expect(result.winnerId).toBe('A');
  });
  it('S7: recycles 27 cards during ten player draw deterministically', () => {
    const players = Array.from({length:10}, (_, i) => String(i)); const deck = createDeck().slice(0,27);
    const shuffledInputs: Card[][] = []; const shuffledOutputs: Card[][] = [];
    const run = () => {
      const rng = createRng('S7').fork('baicao');
      return resolveBaiCao(players, deck, { ...rng, shuffle<T>(items: readonly T[]): T[] {
        const result = rng.shuffle(items);
        shuffledInputs.push([...items] as unknown as Card[]); shuffledOutputs.push(result as unknown as Card[]);
        return result;
      } });
    };
    const result = run(); expect(result).toEqual(run()); expect(players).toContain(result.winnerId);
    expect(result.rounds[0]).toHaveLength(10); checkHands(result.rounds);
    expect(shuffledInputs[0]!.map(formatCard).sort()).toEqual(deck.map(formatCard).sort());
    const expected = createRng('S7').fork('baicao').shuffle(deck);
    expect(shuffledOutputs[0]).toEqual(expected);
    expect(shuffledOutputs[0]).not.toEqual(deck);
    expect(result.rounds[0]![9]!.cards).toEqual(expected.slice(0, 3));
    const last = result.rounds.at(-1)!;
    const winner = last.find(draw => draw.playerId === result.winnerId)!;
    expect(last.filter(draw => compareBaiCao(draw.cards, winner.cards) === 0)).toHaveLength(1);
    expect(last.every(draw => compareBaiCao(winner.cards, draw.cards) >= 0)).toBe(true);
  });
  it('S7: preserves partial hands when recycling 31 or four cards', () => {
    const faces = parseCards('Jc Qc Kc Jd Qd Kd Jh Qh Kh');
    const faceNames = new Set(faces.map(formatCard));
    const deck31 = [...faces, ...createDeck().filter(card => !faceNames.has(formatCard(card)))].slice(0, 31);
    for (const [players, deck] of [
      [Array.from({ length: 8 }, (_, i) => String(i)), deck31],
      [['A', 'B'], parseCards('As 2s 3s 4s')],
    ] as [string[], Card[]][]) {
      const result = resolveBaiCao(players, deck, createRng('fixed').fork('baicao'));
      checkHands(result.rounds);
      if (deck.length === 31) {
        expect(result.rounds.length).toBeGreaterThan(1);
        expect(result.rounds[1]!.length).toBeGreaterThanOrEqual(3);
        expect(result.rounds[1]![2]!.cards[0]).toEqual(deck[30]);
      }
      if (deck.length === 4) expect(result.rounds[0]![1]!.cards[0]).toEqual(deck[3]);
    }
  });
  it('S2 S7: stops after 1000 tied rounds for a degenerate source', () => {
    const rng = createRng('fixed').fork('baicao'); let shuffles = 0;
    expect(() => resolveBaiCao(['A', 'B'], parseCards('Jc Qd Kh Jh Qs Kc'), {
      ...rng, shuffle<T>(items: readonly T[]): T[] { shuffles++; return rng.shuffle(items); },
    })).toThrow('unresolved after 1000 rounds');
    expect(shuffles).toBe(999);
  });
  it('rejects sources with fewer than three distinct cards', () => {
    for (const cards of ['', 'As', 'As 2s']) {
      expect(() => resolve(['A', 'B'], cards)).toThrow('At least three distinct cards');
    }
    expect(() => resolve(['A', 'B'], 'As As 2s')).toThrow('distinct cards');
  });
  it('rejects an empty draw source and too few contenders', () => {
    expect(() => resolveBaiCao(['A','B'], [], createRng('fixed'))).toThrow();
    expect(() => resolveBaiCao(['A'], createDeck(), createRng('fixed'))).toThrow();
  });
  it('S6 S7: shares draw source across multiple pots and recycles across pot boundaries', () => {
    const undealt = parseCards('4c 5d Kh Qc Jd Ks 2c 3d 4h 2s 2h 3s');
    const rng = createRng('multi-pot').fork('bai-cao');
    const deck0 = createBaiCaoDeck(undealt);

    // Pot 1 consumes first 6 cards: A gets 4c 5d Kh (9), B gets Qc Jd Ks (ba tay) -> B wins
    const pot1 = resolveBaiCaoWithDeck(['A', 'B'], deck0, rng);
    expect(pot1.result.winnerId).toBe('B');
    expect(pot1.nextDeck.index).toBe(6);
    expect(pot1.nextDeck.drawn).toHaveLength(6);

    // Pot 2 continues from index 6: B gets 2c 3d 4h (9), C gets 2s 2h 3s (7) -> B wins
    const pot2 = resolveBaiCaoWithDeck(['B', 'C'], pot1.nextDeck, rng);
    expect(pot2.result.winnerId).toBe('B');
    expect(pot2.result.rounds[0]![0]!.cards).toEqual(undealt.slice(6, 9));
    expect(pot2.result.rounds[0]![1]!.cards).toEqual(undealt.slice(9, 12));
    expect(pot2.nextDeck.index).toBe(12);
    expect(pot2.nextDeck.drawn).toHaveLength(12);

    // Pot 3 starts at exhausted source -> recycles all 12 previously drawn cards deterministically
    const pot3 = resolveBaiCaoWithDeck(['A', 'C'], pot2.nextDeck, rng);
    checkHands(pot3.result.rounds);
    expect(['A', 'C']).toContain(pot3.result.winnerId);

    // Deterministic replay with same seed produces identical results across all three pots
    const replayRng = createRng('multi-pot').fork('bai-cao');
    const r1 = resolveBaiCaoWithDeck(['A', 'B'], createBaiCaoDeck(undealt), replayRng);
    const r2 = resolveBaiCaoWithDeck(['B', 'C'], r1.nextDeck, replayRng);
    const r3 = resolveBaiCaoWithDeck(['A', 'C'], r2.nextDeck, replayRng);
    expect(r1.result).toEqual(pot1.result);
    expect(r2.result).toEqual(pot2.result);
    expect(r3.result).toEqual(pot3.result);
  });
});
