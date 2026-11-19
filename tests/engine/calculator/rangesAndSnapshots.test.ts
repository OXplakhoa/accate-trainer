import { describe, expect, it } from 'vitest';
import { formatCard, parseCard, parseCards } from '../../../src/engine/cards';
import {
  CalculatorError,
  comboKey,
  extractDecisionSnapshot,
  normalizeOpponentRange,
} from '../../../src/engine/calculator';
import {
  assertHandUnchangedAndValid,
  assertPureFixtureInv1,
  buildH1DecisionStates,
  captureChipSnapshot,
} from './helpers';

describe('calculator/ranges & DecisionSnapshot', () => {
  it('identifies physical combos independent of card order and removes blockers & zero weights', () => {
    assertPureFixtureInv1(6);

    const k1 = comboKey([parseCard('As'), parseCard('Kh')]);
    const k2 = comboKey([parseCard('Kh'), parseCard('As')]);
    expect(k1).toBe(k2);
    expect(k1).toBe('AsKh');

    const normalized = normalizeOpponentRange(
      {
        opponentId: 'B',
        label: 'Điên — flop raise range',
        combos: [
          { cards: [parseCard('8h'), parseCard('6h')], weight: 2 },
          { cards: [parseCard('6h'), parseCard('8h')], weight: 1.5 }, // duplicate reversed
          { cards: [parseCard('Js'), parseCard('Ac')], weight: 3 }, // blocked by hero Js
          { cards: [parseCard('9h'), parseCard('8s')], weight: 4 }, // blocked by board 9h
          { cards: [parseCard('5d'), parseCard('4d')], weight: 2 }, // blocked by dead card 5d
          { cards: [parseCard('Qc'), parseCard('Qd')], weight: 0 }, // zero weight
          { cards: [parseCard('Ac'), parseCard('Kc')], weight: 1 },
        ],
      },
      parseCards('Js Jd 9h 7h 2c 5d'),
    );

    expect(normalized.combos).toHaveLength(2);
    expect(normalized.totalWeight).toBeCloseTo(4.5, 10);
    expect(normalized.summary.mergedDuplicateCount).toBe(1);
    expect(normalized.summary.removedByBlockerCount).toBe(3);
    expect(normalized.summary.removedZeroWeightCount).toBe(1);
    expect(normalized.summary.duplicatePolicy).toBe('sum');

    const byKey = new Map(normalized.combos.map((c) => [c.key, c.weight]));
    expect(byKey.get('8h6h')).toBeCloseTo(3.5, 10);
    expect(byKey.get('AcKc')).toBeCloseTo(1, 10);

    assertPureFixtureInv1(6);
  });

  it('supports duplicatePolicy="error" and rejects invalid or impossible ranges cleanly', () => {
    assertPureFixtureInv1(6);

    expect(() =>
      normalizeOpponentRange(
        {
          opponentId: 'B',
          combos: [
            { cards: [parseCard('8h'), parseCard('6h')], weight: 1 },
            { cards: [parseCard('6h'), parseCard('8h')], weight: 1 },
          ],
        },
        [],
        { duplicatePolicy: 'error' },
      ),
    ).toThrowError(CalculatorError);

    try {
      normalizeOpponentRange(
        {
          opponentId: 'B',
          combos: [
            { cards: [parseCard('8h'), parseCard('6h')], weight: 1 },
            { cards: [parseCard('6h'), parseCard('8h')], weight: 1 },
          ],
        },
        [],
        { duplicatePolicy: 'error' },
      );
    } catch (err) {
      expect(err).toBeInstanceOf(CalculatorError);
      expect((err as CalculatorError).code).toBe('duplicate-combo');
    }

    // All combos blocked -> empty-range-after-blockers
    expect(() =>
      normalizeOpponentRange(
        {
          opponentId: 'B',
          combos: [
            { cards: [parseCard('Js'), parseCard('Ac')], weight: 1 },
            { cards: [parseCard('9h'), parseCard('8h')], weight: 2 },
          ],
        },
        parseCards('Js Jd 9h 7h 2c'),
      ),
    ).toThrowError(/no viable combos/i);

    // Same physical card twice in one combo
    expect(() =>
      normalizeOpponentRange(
        {
          opponentId: 'B',
          combos: [{ cards: [parseCard('As'), parseCard('As')], weight: 1 }],
        },
        [],
      ),
    ).toThrowError(CalculatorError);

    // Negative / NaN / Infinity weights
    for (const badWeight of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        normalizeOpponentRange(
          {
            opponentId: 'B',
            combos: [{ cards: [parseCard('As'), parseCard('Ks')], weight: badWeight }],
          },
          [],
        ),
      ).toThrowError(CalculatorError);
    }

    // Empty range
    expect(() =>
      normalizeOpponentRange({ opponentId: 'B', combos: [] }, []),
    ).toThrowError(CalculatorError);

    assertPureFixtureInv1(6);
  });

  it('extracts public DecisionSnapshot from H1 without reading hidden cards or mutating chips', () => {
    const { step7FlopC, step13TurnC, step16RiverC } = buildH1DecisionStates();

    const before7 = captureChipSnapshot(step7FlopC);
    const snap7 = extractDecisionSnapshot(step7FlopC, 'C');
    expect(snap7.heroCards.map(formatCard)).toEqual(['Js', 'Jd']);
    expect(snap7.board.map(formatCard)).toEqual(['9h', '7h', '2c']);
    expect(snap7.street).toBe('flop');
    expect(snap7.potBeforeCall).toBe(70);
    expect(snap7.callAmount).toBe(30);
    expect(snap7.toCall).toBe(30);
    expect(snap7.heroStack).toBe(495);
    expect(snap7.streetCap).toBe(50);
    expect(snap7.remainingCapAllowance).toBe(50);
    expect(snap7.activeOpponentCount).toBe(5);
    expect(snap7.position.openerPlayerId).toBe('D');
    expect(snap7.position.playersToActBeforeHero).toEqual(['D', 'E', 'F', 'A', 'B']);
    expect(snap7.position.playersToActAfterHero).toEqual([]);
    expect(snap7.position.actsLast).toBe(true);
    assertHandUnchangedAndValid(step7FlopC, before7);

    // Mutate a cloned HandState's hidden opponent hole cards & undealt deck; snapshot must be identical.
    const alteredHiddenState = {
      ...step7FlopC,
      deck: [...step7FlopC.deck].reverse(),
      seats: step7FlopC.seats.map((seat) =>
        seat.playerId === 'C'
          ? seat
          : { ...seat, holeCards: [parseCard('2s'), parseCard('3s')] as const },
      ),
    };
    const snap7Altered = extractDecisionSnapshot(alteredHiddenState, 'C');
    expect(snap7Altered).toEqual(snap7);

    const before13 = captureChipSnapshot(step13TurnC);
    const snap13 = extractDecisionSnapshot(step13TurnC, 'C');
    expect(snap13.potBeforeCall).toBe(170);
    expect(snap13.callAmount).toBe(50);
    expect(snap13.streetCap).toBe(50);
    expect(snap13.legalActions?.canRaise).toBe(false);
    assertHandUnchangedAndValid(step13TurnC, before13);

    const before16 = captureChipSnapshot(step16RiverC);
    const snap16 = extractDecisionSnapshot(step16RiverC, 'C');
    expect(snap16.potBeforeCall).toBe(270);
    expect(snap16.callAmount).toBe(50);
    expect(snap16.activeOpponentCount).toBe(1);
    assertHandUnchangedAndValid(step16RiverC, before16);
  });
});
