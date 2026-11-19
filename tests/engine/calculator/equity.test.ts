import { describe, expect, it } from 'vitest';
import { createDeck, formatCard, parseCard, parseCards, type Card } from '../../../src/engine/cards';
import { compareHands, evaluateHand } from '../../../src/engine/handEval';
import { createRng } from '../../../src/engine/rng';
import {
  CalculatorError,
  assumptionsContextFromSnapshot,
  calculateExactEquity,
  extractDecisionSnapshot,
  simulateEquity,
  type OpponentRangeInput,
} from '../../../src/engine/calculator';
import {
  assertHandUnchangedAndValid,
  assertPureFixtureInv1,
  buildH1DecisionStates,
  captureChipSnapshot,
} from './helpers';

/**
 * Completely independent naive brute-force enumeration oracle for small scenarios.
 * Does NOT call any code from `src/engine/calculator/` — only `createDeck`, `evaluateHand`,
 * and `compareHands` — so tests never use the implementation as its own oracle.
 */
function independentBruteForceOracle(params: {
  readonly hero: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly opponentRanges: readonly (readonly { readonly cards: readonly [Card, Card]; readonly weight: number }[])[];
  readonly dead?: readonly Card[];
}): { readonly equity: number; readonly winRate: number; readonly tieRate: number; readonly loseRate: number } {
  const fixedKeys = new Set<string>([
    ...params.hero.map(formatCard),
    ...params.board.map(formatCard),
    ...(params.dead ?? []).map(formatCard),
  ]);
  const fullDeck = createDeck();
  const missingBoard = 5 - params.board.length;

  let totalW = 0;
  let winW = 0;
  let tieW = 0;
  let tieShareW = 0;
  let loseW = 0;

  const chosen: Array<readonly [Card, Card]> = [];

  const evalRunouts = (
    pool: readonly Card[],
    start: number,
    picked: Card[],
    weight: number,
  ): void => {
    if (picked.length === missingBoard) {
      const board5 = [...params.board, ...picked];
      const heroVal = evaluateHand([...params.hero, ...board5]);
      let tied = 0;
      let beaten = false;
      for (const opp of chosen) {
        const cmp = compareHands(heroVal, evaluateHand([...opp, ...board5]));
        if (cmp < 0) {
          beaten = true;
          break;
        }
        if (cmp === 0) {
          tied++;
        }
      }
      totalW += weight;
      if (beaten) {
        loseW += weight;
      } else if (tied === 0) {
        winW += weight;
      } else {
        tieW += weight;
        tieShareW += weight / (1 + tied);
      }
      return;
    }
    for (let i = start; i <= pool.length - (missingBoard - picked.length); i++) {
      picked.push(pool[i]!);
      evalRunouts(pool, i + 1, picked, weight);
      picked.pop();
    }
  };

  const assignOpponents = (depth: number, used: Set<string>, prodWeight: number): void => {
    if (depth === params.opponentRanges.length) {
      const remaining = fullDeck.filter((c) => !used.has(formatCard(c)));
      evalRunouts(remaining, 0, [], prodWeight);
      return;
    }
    for (const entry of params.opponentRanges[depth]!) {
      if (entry.weight <= 0) continue;
      const k0 = formatCard(entry.cards[0]);
      const k1 = formatCard(entry.cards[1]);
      if (used.has(k0) || used.has(k1)) continue;
      used.add(k0);
      used.add(k1);
      chosen.push(entry.cards);
      assignOpponents(depth + 1, used, prodWeight * entry.weight);
      chosen.pop();
      used.delete(k0);
      used.delete(k1);
    }
  };

  assignOpponents(0, new Set(fixedKeys), 1);

  return {
    equity: (winW + tieShareW) / totalW,
    winRate: winW / totalW,
    tieRate: tieW / totalW,
    loseRate: loseW / totalW,
  };
}

describe('calculator/equity', () => {
  it('is strictly deterministic with fixed seeds and varies with different seeds', () => {
    const { step7FlopC } = buildH1DecisionStates();
    const before = captureChipSnapshot(step7FlopC);
    const snap = extractDecisionSnapshot(step7FlopC, 'C');

    const ranges: OpponentRangeInput[] = [
      {
        opponentId: 'B',
        label: 'Điên — flop raise range',
        combos: [
          { cards: [parseCard('8h'), parseCard('6h')], weight: 2 },
          { cards: [parseCard('Ah'), parseCard('Kh')], weight: 1.5 },
          { cards: [parseCard('9s'), parseCard('7s')], weight: 1 },
          { cards: [parseCard('Qd'), parseCard('Tc')], weight: 1 },
        ],
      },
    ];

    const run1 = simulateEquity({
      heroCards: snap.heroCards,
      board: snap.board,
      opponentRanges: ranges,
      rng: createRng('equity-det-seed'),
      samples: 1_500,
      assumptionsContext: assumptionsContextFromSnapshot(snap),
    });
    const run2 = simulateEquity({
      heroCards: snap.heroCards,
      board: snap.board,
      opponentRanges: ranges,
      rng: createRng('equity-det-seed'),
      samples: 1_500,
      assumptionsContext: assumptionsContextFromSnapshot(snap),
    });
    const runOtherSeed = simulateEquity({
      heroCards: snap.heroCards,
      board: snap.board,
      opponentRanges: ranges,
      rng: createRng('equity-other-seed'),
      samples: 1_500,
    });

    expect(run1).toEqual(run2);
    expect(run1.reachedTargetSamples).toBe(true);
    expect(run1.completedSamples).toBe(1_500);
    expect(run1.equity).toBeGreaterThan(0);
    expect(run1.equity).toBeLessThan(1);
    expect(run1.winRate + run1.tieRate + run1.loseRate).toBeCloseTo(1, 12);
    expect(run1.equity).toBeCloseTo(run1.winRate + run1.tieEquityShare, 12);

    // Structured assumptions (D5)
    expect(run1.assumptions.method).toBe('monte-carlo');
    expect(run1.assumptions.opponentCount).toBe(1);
    expect(run1.assumptions.potBeforeAction).toBe(70);
    expect(run1.assumptions.heroStack).toBe(495);
    expect(run1.assumptions.streetCap).toBe(50);
    expect(run1.assumptions.position?.openerPlayerId).toBe('D');
    expect(run1.assumptions.samples?.seed).toBe('equity-det-seed');
    expect(run1.assumptions.samples?.completed).toBe(1_500);

    // Different seed should still stay close to same true equity
    expect(Math.abs(run1.equity - runOtherSeed.equity)).toBeLessThan(0.05);

    assertHandUnchangedAndValid(step7FlopC, before);
  });

  it('handles river certain win (1.0), certain loss (0.0), blockers, and multiway total-tie equity splitting (1/2, 1/3, 1/4)', () => {
    assertPureFixtureInv1(6);

    // River certain win: Hero As Ah vs Villain Kd Ks on 9c 7d 5s 3h 2c
    const certainWin = simulateEquity({
      heroCards: [parseCard('As'), parseCard('Ah')],
      board: parseCards('9c 7d 5s 3h 2c'),
      opponentRanges: [
        {
          opponentId: 'V1',
          combos: [
            { cards: [parseCard('Kd'), parseCard('Ks')], weight: 1 },
            { cards: [parseCard('As'), parseCard('Qd')], weight: 99 }, // blocked by hero As!
          ],
        },
      ],
      rng: createRng('river-win'),
      samples: 200,
    });
    expect(certainWin.winRate).toBe(1);
    expect(certainWin.tieRate).toBe(0);
    expect(certainWin.loseRate).toBe(0);
    expect(certainWin.equity).toBe(1);
    expect(certainWin.assumptions.ranges![0]!.removedByBlockerCount).toBe(1);

    // River certain loss: Hero Js Jd vs B 8h 6h on H1 final board 9h 7h 2c 5s Kc
    const certainLoss = simulateEquity({
      heroCards: [parseCard('Js'), parseCard('Jd')],
      board: parseCards('9h 7h 2c 5s Kc'),
      opponentRanges: [
        {
          opponentId: 'B',
          combos: [{ cards: [parseCard('8h'), parseCard('6h')], weight: 1 }],
        },
      ],
      rng: createRng('river-loss'),
      samples: 200,
    });
    expect(certainLoss.winRate).toBe(0);
    expect(certainLoss.tieRate).toBe(0);
    expect(certainLoss.loseRate).toBe(1);
    expect(certainLoss.equity).toBe(0);

    // Board Royal Flush -> total tie split by share: 2-way (1/2), 3-way (1/3), 4-way (1/4)
    const royalBoard = parseCards('As Ks Qs Js Ts');
    const oppCombos: OpponentRangeInput[] = [
      { opponentId: 'V1', combos: [{ cards: [parseCard('2c'), parseCard('3c')], weight: 1 }] },
      { opponentId: 'V2', combos: [{ cards: [parseCard('4d'), parseCard('5d')], weight: 1 }] },
      { opponentId: 'V3', combos: [{ cards: [parseCard('6h'), parseCard('7h')], weight: 1 }] },
    ];

    for (const numOpps of [1, 2, 3] as const) {
      const res = simulateEquity({
        heroCards: [parseCard('8c'), parseCard('9d')],
        board: royalBoard,
        opponentRanges: oppCombos.slice(0, numOpps),
        rng: createRng(`royal-tie-${numOpps}`),
        samples: 200,
      });
      const expectedShare = 1 / (numOpps + 1);
      expect(res.winRate).toBe(0);
      expect(res.loseRate).toBe(0);
      expect(res.tieRate).toBe(1);
      expect(res.tieEquityShare).toBeCloseTo(expectedShare, 12);
      expect(res.equity).toBeCloseTo(expectedShare, 12);
    }

    assertPureFixtureInv1(6);
  });

  it('matches independent brute-force oracle on weighted multiway ranges with card conflicts regardless of seat order', () => {
    assertPureFixtureInv1(6);

    // Classic seat-order bias trap:
    // Board: 2d 7c 9h Js 3s (river, no straight/flush possible for any listed combo)
    // Hero: Td Tc (pair of Tens)
    // Opp 1: { As Ah (beats hero, w=3), 4c 5c (J-high, loses to hero, w=1) }
    // Opp 2: { As Kd (A-high, loses to hero, w=3), 4h 5h (J-high, loses to hero, w=1) }
    // Valid disjoint tuples:
    // - (AsAh, AsKd): CONFLICT on As!
    // - (AsAh, 4h5h): w = 3*1 = 3 -> hero LOSES (AA)
    // - (4c5c, AsKd): w = 1*3 = 3 -> hero WINS (TT beats AK & 54)
    // - (4c5c, 4h5h): w = 1*1 = 1 -> hero WINS (TT beats 54 & 54)
    // Exact product-weight equity = (3 + 1) / (3 + 3 + 1) = 4 / 7 = 0.57142857...
    // (Note: naive sequential sampling [Opp1, Opp2] would give Opp1=AsAh prob 3/4 -> hero equity = 1/4 = 0.25;
    //  reversing [Opp2, Opp1] sequentially would give Opp2=AsKd prob 3/4 -> hero equity = 3/4 + 1/4*1/4 = 0.8125.
    //  Both naive orders are wildly wrong compared to exact 4/7 = 0.5714!)
    const hero: readonly [Card, Card] = [parseCard('Td'), parseCard('Tc')];
    const board = parseCards('2d 7c 9h Js 3s');
    const opp1: OpponentRangeInput = {
      opponentId: 'Opp1',
      combos: [
        { cards: [parseCard('As'), parseCard('Ah')], weight: 3 },
        { cards: [parseCard('4c'), parseCard('5c')], weight: 1 },
      ],
    };
    const opp2: OpponentRangeInput = {
      opponentId: 'Opp2',
      combos: [
        { cards: [parseCard('As'), parseCard('Kd')], weight: 3 },
        { cards: [parseCard('4h'), parseCard('5h')], weight: 1 },
      ],
    };

    const oracle = independentBruteForceOracle({
      hero,
      board,
      opponentRanges: [opp1.combos, opp2.combos],
    });
    expect(oracle.equity).toBeCloseTo(4 / 7, 12);

    const exactOrderA = calculateExactEquity({
      heroCards: hero,
      board,
      opponentRanges: [opp1, opp2],
    });
    const exactOrderB = calculateExactEquity({
      heroCards: hero,
      board,
      opponentRanges: [opp2, opp1],
    });
    expect(exactOrderA.equity).toBeCloseTo(oracle.equity, 12);
    expect(exactOrderB.equity).toBeCloseTo(oracle.equity, 12);

    const mcOrderA = simulateEquity({
      heroCards: hero,
      board,
      opponentRanges: [opp1, opp2],
      rng: createRng('seat-order-A'),
      samples: 10_000,
    });
    const mcOrderB = simulateEquity({
      heroCards: hero,
      board,
      opponentRanges: [opp2, opp1],
      rng: createRng('seat-order-B'),
      samples: 10_000,
    });

    // Both seat orders converge tightly to 4/7 (0.5714), nowhere near naive 0.25 or 0.8125!
    expect(Math.abs(mcOrderA.equity - oracle.equity)).toBeLessThan(0.02);
    expect(Math.abs(mcOrderB.equity - oracle.equity)).toBeLessThan(0.02);
    expect(mcOrderA.rejectedAttempts).toBeGreaterThan(0);

    // Also verify small turn scenario against independent oracle
    const turnBoard = parseCards('9h 7h 2c 5s');
    const turnHero: readonly [Card, Card] = [parseCard('Js'), parseCard('Jd')];
    const turnOpp: OpponentRangeInput = {
      opponentId: 'B',
      combos: [
        { cards: [parseCard('8h'), parseCard('6h')], weight: 2 }, // already straight!
        { cards: [parseCard('Ah'), parseCard('Kh')], weight: 1 }, // flush draw + overcards
      ],
    };
    const turnOracle = independentBruteForceOracle({
      hero: turnHero,
      board: turnBoard,
      opponentRanges: [turnOpp.combos],
    });
    const turnExact = calculateExactEquity({
      heroCards: turnHero,
      board: turnBoard,
      opponentRanges: [turnOpp],
    });
    expect(turnExact.equity).toBeCloseTo(turnOracle.equity, 12);

    const turnMc = simulateEquity({
      heroCards: turnHero,
      board: turnBoard,
      opponentRanges: [turnOpp],
      rng: createRng('turn-oracle-mc'),
      samples: 8_000,
    });
    expect(Math.abs(turnMc.equity - turnOracle.equity)).toBeLessThan(0.02);

    // Small flop scenario verified against independent brute-force oracle (C(45, 2) = 990 runouts)
    const flopBoard = parseCards('9h 7h 2c');
    const flopHero: readonly [Card, Card] = [parseCard('Js'), parseCard('Jd')];
    const flopOpp: OpponentRangeInput = {
      opponentId: 'B',
      combos: [{ cards: [parseCard('8h'), parseCard('6h')], weight: 1 }],
    };
    const flopOracle = independentBruteForceOracle({
      hero: flopHero,
      board: flopBoard,
      opponentRanges: [flopOpp.combos],
    });
    const flopExact = calculateExactEquity({
      heroCards: flopHero,
      board: flopBoard,
      opponentRanges: [flopOpp],
    });
    expect(flopExact.equity).toBeCloseTo(flopOracle.equity, 12);

    const flopMc = simulateEquity({
      heroCards: flopHero,
      board: flopBoard,
      opponentRanges: [flopOpp],
      rng: createRng('flop-oracle-mc'),
      samples: 6_000,
    });
    expect(Math.abs(flopMc.equity - flopOracle.equity)).toBeLessThan(0.02);

    assertPureFixtureInv1(6);
  });

  it('supports preflop, flop, turn, river streets and enforces finite work budget on impossible / high-conflict inputs', () => {
    assertPureFixtureInv1(6);

    // Preflop (0 board cards): AA vs KK should be ~82%
    const preflop = simulateEquity({
      heroCards: [parseCard('As'), parseCard('Ah')],
      board: [],
      opponentRanges: [
        {
          opponentId: 'V1',
          combos: [{ cards: [parseCard('Ks'), parseCard('Kh')], weight: 1 }],
        },
      ],
      rng: createRng('preflop-aa-kk'),
      samples: 3_000,
    });
    expect(preflop.street).toBe('preflop');
    expect(preflop.equity).toBeGreaterThan(0.78);
    expect(preflop.equity).toBeLessThan(0.86);

    // Impossible multiway combination: Opp1 only has AsKs, Opp2 only has AsQd (always collide on As)
    try {
      simulateEquity({
        heroCards: [parseCard('2c'), parseCard('3c')],
        board: parseCards('4d 5d 6d'),
        opponentRanges: [
          { opponentId: 'V1', combos: [{ cards: [parseCard('As'), parseCard('Ks')], weight: 1 }] },
          { opponentId: 'V2', combos: [{ cards: [parseCard('As'), parseCard('Qd')], weight: 1 }] },
        ],
        rng: createRng('impossible-multiway'),
        samples: 500,
      });
      throw new Error('Expected CalculatorError for impossible multiway ranges');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculatorError);
      expect((err as CalculatorError).code).toBe('impossible-range-combination');
    }

    // Feasible but very high-conflict range with tight maxAttempts -> partial sample report
    const highConflictOpp1: OpponentRangeInput = {
      opponentId: 'V1',
      combos: [
        { cards: [parseCard('As'), parseCard('Ks')], weight: 99 },
        { cards: [parseCard('Qc'), parseCard('Jc')], weight: 1 },
      ],
    };
    const highConflictOpp2: OpponentRangeInput = {
      opponentId: 'V2',
      combos: [
        { cards: [parseCard('As'), parseCard('Qd')], weight: 99 },
        { cards: [parseCard('Tc'), parseCard('9c')], weight: 1 },
      ],
    };
    const partial = simulateEquity({
      heroCards: [parseCard('2c'), parseCard('3c')],
      board: parseCards('4d 5d 6h 7s 8d'),
      opponentRanges: [highConflictOpp1, highConflictOpp2],
      rng: createRng('tight-budget'),
      samples: 500,
      maxAttempts: 200,
    });
    expect(partial.reachedTargetSamples).toBe(false);
    expect(partial.stopReason).toBe('max-attempts-reached');
    expect(partial.attempts).toBe(200);
    expect(partial.completedSamples).toBeGreaterThan(0);
    expect(partial.completedSamples).toBeLessThan(500);
    expect(partial.warning).not.toBeNull();
    expect(Number.isFinite(partial.equity)).toBe(true);
    expect(partial.assumptions.samples?.reachedTarget).toBe(false);

    // Feasible range with maxAttempts too tiny to collect even 1 valid sample -> clear error
    try {
      simulateEquity({
        heroCards: [parseCard('2c'), parseCard('3c')],
        board: parseCards('4d 5d 6h 7s 8d'),
        opponentRanges: [
          {
            opponentId: 'V1',
            combos: [
              { cards: [parseCard('As'), parseCard('Ks')], weight: 10_000 },
              { cards: [parseCard('Qc'), parseCard('Jc')], weight: 1 },
            ],
          },
          {
            opponentId: 'V2',
            combos: [
              { cards: [parseCard('As'), parseCard('Qd')], weight: 10_000 },
              { cards: [parseCard('Tc'), parseCard('9c')], weight: 1 },
            ],
          },
        ],
        rng: createRng('zero-samples-budget'),
        samples: 100,
        maxAttempts: 5,
      });
      throw new Error('Expected max-attempts-exceeded-no-samples');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculatorError);
      expect((err as CalculatorError).code).toBe('max-attempts-exceeded-no-samples');
    }

    // Exact enumeration work limit guard
    expect(() =>
      calculateExactEquity({
        heroCards: [parseCard('As'), parseCard('Ah')],
        board: [],
        opponentRanges: [
          { opponentId: 'V1', combos: [{ cards: [parseCard('Ks'), parseCard('Kh')], weight: 1 }] },
        ],
        maxEvaluations: 100,
      }),
    ).toThrowError(CalculatorError);

    assertPureFixtureInv1(6);
  });
});
