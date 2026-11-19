import { afterEach, describe, expect, it } from 'vitest';
import { CHIP_SET, checkInv1 } from '../../src/engine/chips';
import { createDeck, parseCards } from '../../src/engine/cards';
import { compareHands, evaluateHand, type HandCategory } from '../../src/engine/handEval';
afterEach(() => expect(checkInv1([CHIP_SET])).toEqual({ ok: true }));
const evalHand = (s: string) => evaluateHand(parseCards(s));
describe('Holdem evaluation', () => {
  it('recognizes categories and straight boundaries', () => {
    const examples: [string, HandCategory, number[]][] = [
      ['As Kd 9c 7h 3s', 'high-card', [14,13,9,7,3]], ['Ks Qd 9c 7h 3s','high-card',[13,12,9,7,3]],
      ['As Ad 9c 7h 3s','pair',[14,9,7,3]], ['Ks Kd 9c 7h 3s','pair',[13,9,7,3]],
      ['As Ad 9c 9h 3s','two-pair',[14,9,3]], ['Ks Kd 8c 8h 3s','two-pair',[13,8,3]],
      ['As Ad Ac 7h 3s','three-of-a-kind',[14,7,3]], ['Ks Kd Kc 7h 3s','three-of-a-kind',[13,7,3]],
      ['As 2d 3c 4h 5s','straight',[5]], ['As Kd Qc Jh Ts','straight',[14]],
      ['As Js 9s 7s 3s','flush',[14,11,9,7,3]], ['Ah Jh 9h 7h 3h','flush',[14,11,9,7,3]],
      ['As Ad Ac 7h 7s','full-house',[14,7]], ['Ks Kd Kc 7h 7s','full-house',[13,7]],
      ['As Ad Ac Ah 3s','four-of-a-kind',[14,3]], ['Ks Kd Kc Kh 3s','four-of-a-kind',[13,3]],
      ['As 2s 3s 4s 5s','straight-flush',[5]], ['As Ks Qs Js Ts','straight-flush',[14]],
    ];
    for (const [input, category, ranks] of examples) {
      const hand = evalHand(input);
      expect(hand.category).toBe(category); expect(hand.ranks).toEqual(ranks); expect(hand.best5).toHaveLength(5);
    }
    expect(evalHand('Qs Kd Ac 2h 3s').category).toBe('high-card');
  });
  it('compares kickers', () => {
    for (const [a,b] of [
      ['As Ad Kc 7h 3s','Ah Ac Qc 7d 3h'], ['As Ad Kc Kh Qs','Ah Ac Kd Ks Js'],
      ['As Ad Ac Kh Qs','Ah Ac As Kd Js'], ['As Js 9s 7s 4s','Ah Jh 9h 7h 3h'],
    ]) expect(compareHands(evalHand(a!), evalHand(b!))).toBe(1);
  });
  it('selects the strongest five from seven', () => {
    for (const [input, category, ranks] of [
      ['2s 4s 6s 8s Ts 7d 9h','flush',[10,8,6,4,2]],
      ['As Ad Ac Ks Kd Kc 2h','full-house',[14,13]],
      ['As Ad Ks Kd Qs Qd Jh','two-pair',[14,13,12]],
      ['As Ad Ac Ah Ks Qd Jh','four-of-a-kind',[14,13]],
    ] as [string, HandCategory, number[]][]) {
      const result = evalHand(input); expect(result.category).toBe(category); expect(result.ranks).toEqual(ranks);
      expect(evaluateHand(result.best5).ranks).toEqual(ranks);
    }
  });
  it('S1: board plays and suits do not break ties', () => {
    expect(compareHands(evalHand('5c 6d 7h 8s 9c 2s 3d'), evalHand('5c 6d 7h 8s 9c 2h 4d'))).toBe(0);
  });
  it('rejects invalid lengths and duplicates', () => {
    for (const input of ['As Ks Qs Js', 'As Ks Qs Js Ts 9s 8s 7s', 'As As Qs Js Ts']) expect(() => evalHand(input)).toThrow();
  });
  it('counts every five-card hand', () => {
    const deck = createDeck();
    const counts: Record<string, number> = {};
    for (let a=0;a<48;a++) for(let b=a+1;b<49;b++) for(let c=b+1;c<50;c++) for(let d=c+1;d<51;d++) for(let e=d+1;e<52;e++) {
      const category = evaluateHand([deck[a]!,deck[b]!,deck[c]!,deck[d]!,deck[e]!]).category;
      counts[category] = (counts[category] ?? 0) + 1;
    }
    expect(counts).toEqual({ 'straight-flush':40, 'four-of-a-kind':624, 'full-house':3744, flush:5108, straight:10200, 'three-of-a-kind':54912, 'two-pair':123552, pair:1098240, 'high-card':1302540 });
  }, 120000);
});
