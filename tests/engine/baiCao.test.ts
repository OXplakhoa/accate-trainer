import { afterEach, describe, expect, it } from 'vitest';
import { CHIP_SET, checkInv1 } from '../../src/engine/chips';
import { createDeck, parseCards } from '../../src/engine/cards';
import { createRng } from '../../src/engine/rng';
import { baiCaoPoints, compareBaiCao, isBaTay, resolveBaiCao } from '../../src/engine/baiCao';
afterEach(() => expect(checkInv1([CHIP_SET])).toEqual({ ok: true }));
const resolve = (players: string[], cards: string) => resolveBaiCao(players, parseCards(cards), createRng('fixed').fork('baicao'));
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
    const run = () => resolveBaiCao(players, deck, createRng('S7').fork('baicao'));
    const result = run(); expect(result).toEqual(run()); expect(players).toContain(result.winnerId);
    expect(result.rounds[0]).toHaveLength(10); expect(result.rounds[0]!.every(d => d.cards.length === 3)).toBe(true);
  });
  it('rejects an empty draw source and too few contenders', () => {
    expect(() => resolveBaiCao(['A','B'], [], createRng('fixed'))).toThrow();
    expect(() => resolveBaiCao(['A'], createDeck(), createRng('fixed'))).toThrow();
  });
});
