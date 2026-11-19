import { describe, expect, it } from 'vitest';
import { createDeck, formatCard, parseCard, parseCards, type Card } from '../../../src/engine/cards';
import { compareHands, evaluateHand } from '../../../src/engine/handEval';
import { createRng } from '../../../src/engine/rng';
import {
  CalculatorError,
  analyzeOutsAgainstRange,
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

  it('rejects impossible card-pool cardinality quickly without repeating feasibility DFS (6 opponents on 10-card pool)', () => {
    assertPureFixtureInv1(6);

    const hero: readonly [Card, Card] = [parseCard('As'), parseCard('Ad')];
    const board = parseCards('2c 4d 7h 9s Jc');
    const pool = parseCards('2d 3d 4c 5d 6d 7d 8d 9d Td Jd');
    const all45Pairs: Array<{ readonly cards: readonly [Card, Card]; readonly weight: number }> = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        all45Pairs.push({ cards: [pool[i]!, pool[j]!], weight: 1 });
      }
    }
    expect(all45Pairs).toHaveLength(45);

    const sixOpponents: OpponentRangeInput[] = Array.from({ length: 6 }, (_, idx) => ({
      opponentId: `O${idx + 1}`,
      combos: all45Pairs,
    }));

    // simulateEquity with samples=1000, maxAttempts=1000 and with default maxAttempts (250,000)
    for (const maxAttempts of [1_000, undefined] as const) {
      try {
        simulateEquity({
          heroCards: hero,
          board,
          opponentRanges: sixOpponents,
          rng: createRng('cardinality-10-pool'),
          samples: 1_000,
          ...(maxAttempts !== undefined ? { maxAttempts } : {}),
        });
        throw new Error('Expected impossible-range-combination');
      } catch (err) {
        expect(err).toBeInstanceOf(CalculatorError);
        expect((err as CalculatorError).code).toBe('impossible-range-combination');
      }
    }

    // calculateExactEquity also rejects immediately via cardinality check
    try {
      calculateExactEquity({
        heroCards: hero,
        board,
        opponentRanges: sixOpponents,
      });
      throw new Error('Expected impossible-range-combination');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculatorError);
      expect((err as CalculatorError).code).toBe('impossible-range-combination');
    }

    // Subset cardinality trap: 6 opponents on 10-card pool + 7th opponent on disjoint cards
    // (global union is 14 >= 14, yet the 6-opponent subset only has 10 < 12 cards)
    const sevenOpponents: OpponentRangeInput[] = [
      ...sixOpponents,
      {
        opponentId: 'O7',
        combos: [
          { cards: [parseCard('Qh'), parseCard('Kh')], weight: 1 },
          { cards: [parseCard('Qs'), parseCard('Ks')], weight: 1 },
        ],
      },
    ];
    for (const fn of [
      () =>
        simulateEquity({
          heroCards: hero,
          board,
          opponentRanges: sevenOpponents,
          rng: createRng('subset-cardinality'),
          samples: 100,
          maxAttempts: 500,
        }),
      () =>
        calculateExactEquity({
          heroCards: hero,
          board,
          opponentRanges: sevenOpponents,
        }),
    ]) {
      try {
        fn();
        throw new Error('Expected impossible-range-combination');
      } catch (err) {
        expect(err).toBeInstanceOf(CalculatorError);
        expect((err as CalculatorError).code).toBe('impossible-range-combination');
      }
    }

    assertPureFixtureInv1(6);
  });

  it('bounds DFS exhaustion without repeating work in simulateEquity and caps partial-tuple exploration in calculateExactEquity', () => {
    assertPureFixtureInv1(6);

    // Hub-leaf construction: 6 opponents, each combo pairs 1 card from 5-card hub H
    // with 1 card from 15-card leaf set L (75 combos per opponent, 20-card union >= 12).
    // Passes cardinality checks, yet no 6 pairwise-disjoint combos exist because |H| = 5 < 6,
    // generating millions of partial tuples with 0 completed showdowns.
    const hero: readonly [Card, Card] = [parseCard('As'), parseCard('Ad')];
    const board = parseCards('2c 4d 7h 9s Jc');
    const hub = parseCards('2d 3d 4c 5d 6d');
    const leaves = parseCards('7d 8d 9d Td Jd Qd Kd 2h 3h 4h 5h 6h 8h Th Qh');
    const hubLeafCombos: Array<{ readonly cards: readonly [Card, Card]; readonly weight: number }> =
      [];
    for (const h of hub) {
      for (const l of leaves) {
        hubLeafCombos.push({ cards: [h, l], weight: 1 });
      }
    }
    const sixHubLeafOpps: OpponentRangeInput[] = Array.from({ length: 6 }, (_, idx) => ({
      opponentId: `HL${idx + 1}`,
      combos: hubLeafCombos,
    }));

    // simulateEquity: bounded DFS runs AT MOST ONCE when it returns 'unknown', then finishes
    // maxAttempts quickly and preserves distinct max-attempts-exceeded-no-samples error semantics.
    try {
      simulateEquity({
        heroCards: hero,
        board,
        opponentRanges: sixHubLeafOpps,
        rng: createRng('hub-leaf-dfs-unknown'),
        samples: 1_000,
        maxAttempts: 1_000,
        maxFeasibilitySteps: 2_000,
      });
      throw new Error('Expected max-attempts-exceeded-no-samples');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculatorError);
      expect((err as CalculatorError).code).toBe('max-attempts-exceeded-no-samples');
    }

    // Feasible hub-leaf variant (6 hub cards -> valid disjoint tuple exists) with tiny
    // maxFeasibilitySteps so DFS returns 'unknown', verifying it is never misclassified as impossible
    // and can still collect valid samples without repeating DFS.
    const feasibleHub = parseCards('2d 3d 4c 5d 6d Kh');
    const feasibleCombos: Array<{ readonly cards: readonly [Card, Card]; readonly weight: number }> =
      [];
    for (const h of feasibleHub) {
      for (const l of leaves) {
        feasibleCombos.push({ cards: [h, l], weight: 1 });
      }
    }
    const sixFeasibleHubLeafOpps: OpponentRangeInput[] = Array.from({ length: 6 }, (_, idx) => ({
      opponentId: `FHL${idx + 1}`,
      combos: feasibleCombos,
    }));
    const feasibleSim = simulateEquity({
      heroCards: hero,
      board,
      opponentRanges: sixFeasibleHubLeafOpps,
      rng: createRng('feasible-hub-leaf-dfs-unknown'),
      samples: 10,
      maxAttempts: 5_000,
      maxFeasibilitySteps: 5,
    });
    expect(feasibleSim.completedSamples).toBeGreaterThan(0);
    expect(Number.isFinite(feasibleSim.equity)).toBe(true);

    // calculateExactEquity: partial-tuple exploration cap triggers cleanly even with 0 completed runouts
    try {
      calculateExactEquity({
        heroCards: hero,
        board,
        opponentRanges: sixHubLeafOpps,
      });
      throw new Error('Expected exact-enumeration-limit-exceeded');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculatorError);
      expect((err as CalculatorError).code).toBe('exact-enumeration-limit-exceeded');
    }

    // Explicit maxSearchSteps cap works and preserves exact-enumeration-limit-exceeded semantics
    try {
      calculateExactEquity({
        heroCards: hero,
        board,
        opponentRanges: sixHubLeafOpps,
        maxSearchSteps: 500,
      });
      throw new Error('Expected exact-enumeration-limit-exceeded');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculatorError);
      expect((err as CalculatorError).code).toBe('exact-enumeration-limit-exceeded');
    }

    // Small impossible hub-leaf fixture (|H| = 2, |L| = 5, 3 opponents -> union 7 >= 6)
    // completes within maxSearchSteps and throws distinct impossible-range-combination.
    const smallHub = parseCards('2d 3d');
    const smallLeaves = parseCards('5d 6d 7d 8d 9d');
    const smallCombos: Array<{ readonly cards: readonly [Card, Card]; readonly weight: number }> = [];
    for (const h of smallHub) {
      for (const l of smallLeaves) {
        smallCombos.push({ cards: [h, l], weight: 1 });
      }
    }
    const threeSmallHubLeaf: OpponentRangeInput[] = Array.from({ length: 3 }, (_, idx) => ({
      opponentId: `SHL${idx + 1}`,
      combos: smallCombos,
    }));
    try {
      calculateExactEquity({
        heroCards: hero,
        board,
        opponentRanges: threeSmallHubLeaf,
      });
      throw new Error('Expected impossible-range-combination');
    } catch (err) {
      expect(err).toBeInstanceOf(CalculatorError);
      expect((err as CalculatorError).code).toBe('impossible-range-combination');
    }

    // Budget parameters reject non-safe integers and non-positive values
    const baseOpp: OpponentRangeInput[] = [
      { opponentId: 'V1', combos: [{ cards: [parseCard('Kd'), parseCard('Ks')], weight: 1 }] },
    ];
    for (const badBudget of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 1e20]) {
      for (const call of [
        () =>
          simulateEquity({
            heroCards: hero,
            board,
            opponentRanges: baseOpp,
            rng: createRng('bad-budget'),
            samples: badBudget,
          }),
        () =>
          simulateEquity({
            heroCards: hero,
            board,
            opponentRanges: baseOpp,
            rng: createRng('bad-budget'),
            samples: 10,
            maxAttempts: badBudget,
          }),
        () =>
          simulateEquity({
            heroCards: hero,
            board,
            opponentRanges: baseOpp,
            rng: createRng('bad-budget'),
            samples: 10,
            maxFeasibilitySteps: badBudget,
          }),
        () =>
          calculateExactEquity({
            heroCards: hero,
            board,
            opponentRanges: baseOpp,
            maxEvaluations: badBudget,
          }),
        () =>
          calculateExactEquity({
            heroCards: hero,
            board,
            opponentRanges: baseOpp,
            maxSearchSteps: badBudget,
          }),
      ]) {
        try {
          call();
          throw new Error(`Expected invalid-sample-config for budget ${String(badBudget)}`);
        } catch (err) {
          expect(err).toBeInstanceOf(CalculatorError);
          expect((err as CalculatorError).code).toBe('invalid-sample-config');
        }
      }
    }

    assertPureFixtureInv1(6);
  });

  it('preserves multiway scale invariance across extreme weights (1e-180, 1e180, subnormals, dynamic range) and handles unrepresentable totals cleanly', () => {
    assertPureFixtureInv1(6);

    const hero: readonly [Card, Card] = [parseCard('As'), parseCard('Ad')];
    const board = parseCards('2c 4d 7h 9s Jc');

    const makeFixtureRanges = (scaleA: number, scaleB: number): OpponentRangeInput[] => [
      {
        opponentId: 'A',
        combos: [
          { cards: [parseCard('Jd'), parseCard('Jh')], weight: scaleA }, // set of Jacks beats AA
          { cards: [parseCard('8h'), parseCard('8d')], weight: scaleA }, // pair of 8s loses to AA
        ],
      },
      {
        opponentId: 'B',
        combos: [{ cards: [parseCard('5s'), parseCard('6s')], weight: scaleB }], // high card loses
      },
    ];

    // Exact scale invariance at w = 1, 1e-180, 1e180, subnormal MIN_VALUE, 1e307, and asymmetric scales
    const scalePairs: ReadonlyArray<readonly [number, number]> = [
      [1, 1],
      [1e-180, 1e-180],
      [1e180, 1e180],
      [Number.MIN_VALUE, Number.MIN_VALUE],
      [1e307, 1e307],
      [1e-180, 1e180],
      [1e180, 1e-180],
    ];

    for (const [scaleA, scaleB] of scalePairs) {
      const exact = calculateExactEquity({
        heroCards: hero,
        board,
        opponentRanges: makeFixtureRanges(scaleA, scaleB),
      });
      expect(Number.isFinite(exact.equity)).toBe(true);
      expect(exact.equity).toBeCloseTo(0.5, 12);
      expect(exact.winRate).toBeCloseTo(0.5, 12);
      expect(exact.loseRate).toBeCloseTo(0.5, 12);
      expect(exact.tieRate).toBe(0);
    }

    // Sampling scale invariance with fixed seed across extreme representable scales
    const mcBase = simulateEquity({
      heroCards: hero,
      board,
      opponentRanges: makeFixtureRanges(1, 1),
      rng: createRng('scale-inv-mc'),
      samples: 2_000,
    });
    expect(Math.abs(mcBase.equity - 0.5)).toBeLessThan(0.04);

    for (const [scaleA, scaleB] of [
      [1e-180, 1e-180],
      [1e180, 1e180],
      [Number.MIN_VALUE, Number.MIN_VALUE],
      [1e307, 1e307],
    ] as const) {
      const mcScaled = simulateEquity({
        heroCards: hero,
        board,
        opponentRanges: makeFixtureRanges(scaleA, scaleB),
        rng: createRng('scale-inv-mc'),
        samples: 2_000,
      });
      expect(Number.isFinite(mcScaled.equity)).toBe(true);
      expect(mcScaled.equity).toBeCloseTo(mcBase.equity, 12);
      expect(mcScaled.winRate).toBeGreaterThan(0.4);
      expect(mcScaled.loseRate).toBeGreaterThan(0.4);
    }

    // Non-uniform 3-way weighted scale invariance against independent brute-force oracle
    const nonUniformHero: readonly [Card, Card] = [parseCard('Td'), parseCard('Tc')];
    const nonUniformBoard = parseCards('2d 7c 9h Js 3s');
    const baseOpp1 = [
      { cards: [parseCard('As'), parseCard('Ah')] as const, weight: 3 },
      { cards: [parseCard('4c'), parseCard('5c')] as const, weight: 1 },
    ];
    const baseOpp2 = [
      { cards: [parseCard('As'), parseCard('Kd')] as const, weight: 3 },
      { cards: [parseCard('4h'), parseCard('5h')] as const, weight: 1 },
    ];
    const baseOpp3 = [
      { cards: [parseCard('6c'), parseCard('8c')] as const, weight: 2 },
      { cards: [parseCard('6d'), parseCard('8d')] as const, weight: 5 },
    ];
    const oracle3Way = independentBruteForceOracle({
      hero: nonUniformHero,
      board: nonUniformBoard,
      opponentRanges: [baseOpp1, baseOpp2, baseOpp3],
    });
    const scaled3Way = calculateExactEquity({
      heroCards: nonUniformHero,
      board: nonUniformBoard,
      opponentRanges: [
        {
          opponentId: 'O1',
          combos: baseOpp1.map((c) => ({ cards: c.cards, weight: c.weight * 1e-180 })),
        },
        {
          opponentId: 'O2',
          combos: baseOpp2.map((c) => ({ cards: c.cards, weight: c.weight * 1e180 })),
        },
        {
          opponentId: 'O3',
          combos: baseOpp3.map((c) => ({ cards: c.cards, weight: c.weight * 1e-120 })),
        },
      ],
    });
    expect(scaled3Way.equity).toBeCloseTo(oracle3Way.equity, 12);
    expect(scaled3Way.winRate).toBeCloseTo(oracle3Way.winRate, 12);
    expect(scaled3Way.loseRate).toBeCloseTo(oracle3Way.loseRate, 12);

    // Extreme within-range dynamic range where every high-weight combo collides and the ONLY
    // surviving disjoint tuples have product weights 1e-200 * 1e-200 = 1e-400 (lose) and
    // 3e-200 * 1e-200 = 3e-400 (win) -> exact equity = 3/4 = 0.75.
    // Even after per-range maxWeight normalization, linear multiplication would underflow to 0.
    const dynamicExact = calculateExactEquity({
      heroCards: [parseCard('Kc'), parseCard('Kd')],
      board,
      opponentRanges: [
        {
          opponentId: 'A',
          combos: [
            { cards: [parseCard('5s'), parseCard('Jd')], weight: 1 }, // collides with B's Jd8h and 5s6s
            { cards: [parseCard('Jd'), parseCard('Jh')], weight: 1e-200 }, // set of Jacks beats KK
            { cards: [parseCard('8h'), parseCard('8d')], weight: 3e-200 }, // pair of 8s loses to KK
          ],
        },
        {
          opponentId: 'B',
          combos: [
            { cards: [parseCard('Jd'), parseCard('8h')], weight: 1 }, // collides with all 3 combos of A
            { cards: [parseCard('5s'), parseCard('6s')], weight: 1e-200 }, // high card loses to KK
          ],
        },
      ],
    });
    expect(Number.isFinite(dynamicExact.equity)).toBe(true);
    expect(dynamicExact.equity).toBeCloseTo(0.75, 12);
    expect(dynamicExact.completedSamples).toBe(2);

    // Single-range sampling at extreme finite weights (1e307 and Number.MIN_VALUE) must sample
    // both combos ~50/50 and never degenerate to always sampling the last combo.
    for (const extremeWeight of [1e307, Number.MIN_VALUE] as const) {
      const singleSim = simulateEquity({
        heroCards: hero,
        board,
        opponentRanges: [
          {
            opponentId: 'SingleExtreme',
            combos: [
              { cards: [parseCard('Jd'), parseCard('Jh')], weight: extremeWeight }, // hero loses
              { cards: [parseCard('8h'), parseCard('8d')], weight: extremeWeight }, // hero wins
            ],
          },
        ],
        rng: createRng('single-extreme-weight'),
        samples: 1_000,
      });
      expect(Number.isFinite(singleSim.equity)).toBe(true);
      expect(singleSim.winRate).toBeGreaterThan(0.4);
      expect(singleSim.loseRate).toBeGreaterThan(0.4);
    }

    // Unrepresentable single-range total (1e308 + 1e308 = Infinity) must throw invalid-weight cleanly
    // and never silently produce NaN or sample only the last combo.
    const overflowRange: OpponentRangeInput = {
      opponentId: 'Overflow',
      combos: [
        { cards: [parseCard('Jd'), parseCard('Jh')], weight: 1e308 },
        { cards: [parseCard('8h'), parseCard('8d')], weight: 1e308 },
      ],
    };
    for (const call of [
      () =>
        simulateEquity({
          heroCards: hero,
          board,
          opponentRanges: [overflowRange],
          rng: createRng('overflow-single'),
          samples: 200,
        }),
      () =>
        calculateExactEquity({
          heroCards: hero,
          board,
          opponentRanges: [overflowRange],
        }),
      () =>
        analyzeOutsAgainstRange({
          heroCards: hero,
          board: parseCards('2c 4d 7h'),
          opponentRange: overflowRange,
        }),
    ]) {
      try {
        call();
        throw new Error('Expected invalid-weight for unrepresentable total weight');
      } catch (err) {
        expect(err).toBeInstanceOf(CalculatorError);
        expect((err as CalculatorError).code).toBe('invalid-weight');
      }
    }

    assertPureFixtureInv1(6);
  });
});
