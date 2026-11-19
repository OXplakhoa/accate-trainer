import { describe, expect, it } from 'vitest';
import { formatCard, parseCard, parseCards } from '../../../src/engine/cards';
import {
  CalculatorError,
  analyzeHandImprovements,
  analyzeOutsAgainstRange,
  assumptionsContextFromSnapshot,
  createCategoryTargetGroup,
  createPocketPairSetTargetGroup,
  extractDecisionSnapshot,
} from '../../../src/engine/calculator';
import {
  assertHandUnchangedAndValid,
  buildH1DecisionStates,
  captureChipSnapshot,
} from './helpers';

describe('calculator/outs', () => {
  it('verifies H1 #7 (Js Jd on 9h 7h 2c): 2 J outs for set, exact 2/47 turn & 1-(45*44)/(47*46) to river, distinguishing category vs kicker improvements', () => {
    const { step7FlopC } = buildH1DecisionStates();
    const before = captureChipSnapshot(step7FlopC);
    const snap = extractDecisionSnapshot(step7FlopC, 'C');

    const analysis = analyzeHandImprovements({
      heroCards: snap.heroCards,
      board: snap.board,
      targetGroups: [
        createPocketPairSetTargetGroup(snap.heroCards, 'set-j', 'Lên set J'),
        createCategoryTargetGroup('two-pair', 'Lên hai đôi', 'two-pair'),
      ],
    });

    expect(analysis.street).toBe('flop');
    expect(analysis.metricKind).toBe('improvement-probability');
    expect(analysis.unseenCardCount).toBe(47);
    expect(analysis.cardsRemainingToRiver).toBe(2);
    expect(analysis.currentHand.category).toBe('pair');
    expect(analysis.currentHand.ranks).toEqual([11, 9, 7, 2]);

    // Set of Jacks target group: exactly Jh and Jc
    const setGroup = analysis.targetGroups.find((g) => g.id === 'set-j')!;
    expect(setGroup.count).toBe(2);
    expect(setGroup.cards.map(formatCard).sort()).toEqual(['Jc', 'Jh']);
    expect(setGroup.metricKind).toBe('improvement-probability');
    expect(setGroup.probabilities.unseenCards).toBe(47);
    expect(setGroup.probabilities.nextCardExact).toBeCloseTo(2 / 47, 12);
    expect(setGroup.probabilities.toRiverExact).toBeCloseTo(1 - (45 * 44) / (47 * 46), 12);
    expect(setGroup.probabilities.ruleOf4?.probability).toBeCloseTo(0.08, 12);

    // Category improvements: 2 Jacks (set) + 3 Nines + 3 Sevens + 3 Twos (two pair) = 11 cards
    expect(analysis.categoryImprovingCards).toHaveLength(11);
    const twoPairGroup = analysis.targetGroups.find((g) => g.id === 'two-pair')!;
    expect(twoPairGroup.count).toBe(9);

    // Kicker/rank improvements: remaining 36 cards all have rank >= 3 and replace the 2 kicker
    expect(analysis.kickerOrRankImprovingCards).toHaveLength(36);
    expect(
      analysis.categoryImprovingCards.length + analysis.kickerOrRankImprovingCards.length,
    ).toBe(47);

    // Board where low cards do NOT improve hero's hand (Js Jd on Ah Kh Qd -> pair [11, 14, 13, 12])
    const highBoard = analyzeHandImprovements({
      heroCards: [parseCard('Js'), parseCard('Jd')],
      board: parseCards('Ah Kh Qd'),
    });
    const twoClubs = highBoard.candidates.find((c) => formatCard(c.card) === '2c')!;
    expect(twoClubs.improvementKind).toBe('none');
    const jh = highBoard.candidates.find((c) => formatCard(c.card) === 'Jh')!;
    expect(jh.improvementKind).toBe('category');
    expect(jh.after.category).toBe('three-of-a-kind');

    assertHandUnchangedAndValid(step7FlopC, before);
  });

  it('separates clean outs, mixed/dirty outs, and improvement-only cards against an opponent range (including Jh making a set yet losing to 8h6h flush)', () => {
    const { step7FlopC } = buildH1DecisionStates();
    const before = captureChipSnapshot(step7FlopC);
    const snap = extractDecisionSnapshot(step7FlopC, 'C');

    // Scenario 1: Opponent range has { 9s 7s (two pair beating JJ, w=2), 8h 6h (flush draw, w=1) }
    const rangeResult = analyzeOutsAgainstRange({
      heroCards: snap.heroCards,
      board: snap.board,
      opponentRange: {
        opponentId: 'B',
        label: 'Điên — hai đôi 97 + draw thùng 8h6h',
        combos: [
          { cards: [parseCard('9s'), parseCard('7s')], weight: 2 },
          { cards: [parseCard('8h'), parseCard('6h')], weight: 1 },
        ],
      },
      assumptionsContext: assumptionsContextFromSnapshot(snap),
    });

    const cardByCode = new Map(rangeResult.perCard.map((d) => [formatCard(d.card), d]));

    // Jc: Hero makes Set of Jacks -> beats BOTH 9s7s (two pair) AND 8h6h (high card) -> clean-out!
    const jc = cardByCode.get('Jc')!;
    expect(jc.improvementKind).toBe('category');
    expect(jc.heroAfter.category).toBe('three-of-a-kind');
    expect(jc.classification).toBe('clean-out');
    expect(jc.flippedToWinWeight).toBeCloseTo(2, 10);
    expect(jc.winShareAfter).toBe(1);
    expect(jc.stillLosesToSomeComboAfter).toBe(false);

    // Jh: Hero makes Set of Jacks -> beats 9s7s (flipped!), BUT LOSES to 8h6h (J-high flush!) -> mixed-out!
    const jh = cardByCode.get('Jh')!;
    expect(jh.improvementKind).toBe('category');
    expect(jh.heroAfter.category).toBe('three-of-a-kind');
    expect(jh.classification).toBe('mixed-out');
    expect(jh.flippedToWinWeight).toBeCloseTo(2, 10);
    expect(jh.regressedWeight).toBeCloseTo(1, 10);
    expect(jh.winShareAfter).toBeCloseTo(2 / 3, 10);
    expect(jh.loseShareAfter).toBeCloseTo(1 / 3, 10);
    expect(jh.stillLosesToSomeComboAfter).toBe(true);

    // 9c: Hero improves to Two Pair (JJ99), but 9s7s makes Full House (99977) -> improvement-only (still loses!)
    const nineC = cardByCode.get('9c')!;
    expect(nineC.improvementKind).toBe('category');
    expect(nineC.classification).toBe('improvement-only');
    expect(nineC.flippedToWinWeight).toBe(0);
    expect(nineC.stillLosesToSomeComboAfter).toBe(true);

    // Structured assumptions verified (D5)
    expect(rangeResult.assumptions.method).toBe('exact-next-card-enumeration');
    expect(rangeResult.assumptions.opponentCount).toBe(5);
    expect(rangeResult.assumptions.potBeforeAction).toBe(70);
    expect(rangeResult.assumptions.heroStack).toBe(495);
    expect(rangeResult.assumptions.streetCap).toBe(50);
    expect(rangeResult.assumptions.position?.openerPlayerId).toBe('D');
    expect(rangeResult.assumptions.ranges).toHaveLength(1);
    expect(rangeResult.assumptions.ranges![0]!.opponentId).toBe('B');
    expect(rangeResult.assumptions.notes.length).toBeGreaterThan(0);

    // Scenario 2: Same card (Jh) improves hero's hand to a set yet LOSES to villain's lone combo 8h6h
    const vsFlushDrawOnly = analyzeOutsAgainstRange({
      heroCards: snap.heroCards,
      board: snap.board,
      opponentRange: {
        opponentId: 'B',
        combos: [{ cards: [parseCard('8h'), parseCard('6h')], weight: 1 }],
      },
    });
    const jhVsFlushDraw = vsFlushDrawOnly.perCard.find((d) => formatCard(d.card) === 'Jh')!;
    expect(jhVsFlushDraw.improvementKind).toBe('category');
    expect(jhVsFlushDraw.classification).toBe('improvement-only');
    expect(jhVsFlushDraw.stillLosesToSomeComboAfter).toBe(true);
    expect(jhVsFlushDraw.regressedWeight).toBe(1);
    expect(jhVsFlushDraw.nextStreetEquityAfter).toBe(0);

    // Scenario 3: Hero behind overpair Kd Ks -> Jh & Jc are clean outs, while 9c (two pair) improves hero yet still loses to KK99
    const vsKings = analyzeOutsAgainstRange({
      heroCards: snap.heroCards,
      board: snap.board,
      opponentRange: {
        opponentId: 'E',
        combos: [{ cards: [parseCard('Kd'), parseCard('Ks')], weight: 1 }],
      },
    });
    expect(vsKings.cleanOuts.map((d) => formatCard(d.card)).sort()).toEqual(['Jc', 'Jh']);
    const nineCVsKings = vsKings.perCard.find((d) => formatCard(d.card) === '9c')!;
    expect(nineCVsKings.improvementKind).toBe('category');
    expect(nineCVsKings.classification).toBe('improvement-only');
    expect(nineCVsKings.stillLosesToSomeComboAfter).toBe(true);

    assertHandUnchangedAndValid(step7FlopC, before);
  });

  it('handles chop outs, blocked-range cards, river (0 cards left), and rejects preflop', () => {
    const { step16RiverC } = buildH1DecisionStates();
    const before = captureChipSnapshot(step16RiverC);

    // Chop outs on turn: Hero 2c 3d vs Villain Ac Qd on 9s 8s 7d 6h -> any 5 or T completes a board straight (chop!)
    const chopAnalysis = analyzeOutsAgainstRange({
      heroCards: [parseCard('2c'), parseCard('3d')],
      board: parseCards('9s 8s 7d 6h'),
      opponentRange: {
        opponentId: 'V',
        combos: [{ cards: [parseCard('Ac'), parseCard('Qd')], weight: 1 }],
      },
    });
    expect(chopAnalysis.street).toBe('turn');
    expect(chopAnalysis.unseenCardCount).toBe(46);
    expect(chopAnalysis.cardsRemainingToRiver).toBe(1);
    const chopCards = chopAnalysis.chopOuts.map((d) => formatCard(d.card)).sort();
    expect(chopCards).toEqual(['5c', '5d', '5h', '5s', 'Tc', 'Td', 'Th', 'Ts']);
    // Cards Ac and Qd block the only combo in villain's range
    expect(chopAnalysis.blockedCards.map((d) => formatCard(d.card)).sort()).toEqual(['Ac', 'Qd']);

    // River: 0 candidates left
    const snapRiver = extractDecisionSnapshot(step16RiverC, 'C');
    const riverImpr = analyzeHandImprovements({
      heroCards: snapRiver.heroCards,
      board: snapRiver.board,
    });
    expect(riverImpr.street).toBe('river');
    expect(riverImpr.cardsRemainingToRiver).toBe(0);
    expect(riverImpr.candidates).toHaveLength(0);
    expect(riverImpr.probabilities.anyImprovement.toRiverExact).toBe(0);

    // Preflop (0 board cards) rejected for 5-card evaluator outs
    expect(() =>
      analyzeHandImprovements({
        heroCards: [parseCard('As'), parseCard('Ks')],
        board: [],
      }),
    ).toThrowError(CalculatorError);

    assertHandUnchangedAndValid(step16RiverC, before);
  });
});
