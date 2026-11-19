import { describe, expect, it } from 'vitest';
import { initialDistribution } from '../../../src/engine/bank';
import { checkInv1 } from '../../../src/engine/chips';
import { checkHandInvariants, startHand } from '../../../src/engine/hand';
import { createRng } from '../../../src/engine/rng';
import {
  createInitialNongTiltState,
  getActiveBehaviorParams,
  getRivalProfile,
  getRivalSeatMetadata,
  isRivalId,
  NONG_TILT_BEHAVIOR_PARAMS,
  RIVAL_BEHAVIOR_PARAMS,
  RIVAL_DISPLAY_INFO,
  RIVAL_IDS,
  RIVAL_PROFILES,
  selectRivalsForTable,
  type NongTiltState,
} from '../../../src/engine/rivals';

describe('P2b rivals — profiles, seat metadata, and table selection (B3, B4)', () => {
  it('defines all 9 stable rival IDs with separated Vietnamese display info and behavior parameters', () => {
    expect(RIVAL_IDS).toEqual([
      'da',
      'ca',
      'cao',
      'soi',
      'dien',
      'dai-gia',
      'tho',
      'bay',
      'nong',
    ]);
    expect(new Set(RIVAL_IDS).size).toBe(9);

    const expectedNames: Record<(typeof RIVAL_IDS)[number], string> = {
      da: 'Đá',
      ca: 'Cá',
      cao: 'Cáo',
      soi: 'Sói',
      dien: 'Điên',
      'dai-gia': 'Đại gia',
      tho: 'Thỏ',
      bay: 'Bẫy',
      nong: 'Nóng',
    };

    for (const id of RIVAL_IDS) {
      expect(isRivalId(id)).toBe(true);
      const profile = getRivalProfile(id);
      const display = RIVAL_DISPLAY_INFO[id];
      const behavior = RIVAL_BEHAVIOR_PARAMS[id];

      expect(profile.id).toBe(id);
      expect(display.name).toBe(expectedNames[id]);
      expect(display.styleLabel.length).toBeGreaterThan(0);
      expect(display.styleTagVi.length).toBeGreaterThan(0);
      expect(display.summaryVi.length).toBeGreaterThan(0);

      // Verify display object has no numeric behavior thresholds mixed in
      expect('aggressionFreq' in display).toBe(false);
      // Verify behavior object has no display strings mixed in
      expect('name' in behavior).toBe(false);
      expect('summaryVi' in behavior).toBe(false);

      expect(behavior.continueThreshold).toBeGreaterThan(0);
      expect(behavior.continueThreshold).toBeLessThan(1);
      expect(behavior.preferredSizingCapRatio).toBeGreaterThan(0);
      expect(behavior.preferredSizingCapRatio).toBeLessThanOrEqual(1);
    }

    expect(isRivalId('hero')).toBe(false);
    expect(isRivalId('')).toBe(false);
    expect(isRivalId(null)).toBe(false);
    expect(RIVAL_PROFILES.nong.tiltBehavior).toEqual(NONG_TILT_BEHAVIOR_PARAMS);
  });

  it('B3: exposes seat metadata so UI always renders style at the seat, including Nóng public tilt status without consuming tilt count', () => {
    for (const id of RIVAL_IDS) {
      const meta = getRivalSeatMetadata(id);
      expect(meta.rivalId).toBe(id);
      expect(meta.name).toBe(RIVAL_DISPLAY_INFO[id].name);
      expect(meta.styleLabel.length).toBeGreaterThan(0);
      expect(meta.isTilted).toBe(false);
      expect(meta.publicMood).toBe('normal');
      expect(meta.tiltHandsRemaining).toBe(0);
    }

    const normalNong = createInitialNongTiltState();
    const metaNormal = getRivalSeatMetadata('nong', normalNong);
    expect(metaNormal.isTilted).toBe(false);
    expect(metaNormal.publicMood).toBe('normal');
    expect(metaNormal.styleLabel).toContain('Tilter');
    expect(metaNormal.publicStatusLabelVi).toBe('Bình thường');
    expect(getActiveBehaviorParams('nong', normalNong)).toEqual(RIVAL_BEHAVIOR_PARAMS.nong);

    const tiltedState: NongTiltState = {
      isTilted: true,
      handsRemaining: 4,
      totalTiltDuration: 4,
      triggerReason: 'big-pot-loss',
    };

    // Reading metadata multiple times must never decrement handsRemaining
    const read1 = getRivalSeatMetadata('nong', tiltedState);
    const read2 = getRivalSeatMetadata('nong', tiltedState);
    const read3 = getRivalSeatMetadata('nong', tiltedState);
    expect(read1).toEqual(read2);
    expect(read2).toEqual(read3);
    expect(tiltedState.handsRemaining).toBe(4);
    expect(read1.isTilted).toBe(true);
    expect(read1.publicMood).toBe('tilted');
    expect(read1.tiltHandsRemaining).toBe(4);
    expect(read1.styleLabel).toContain('Đang tilt');
    expect(read1.publicStatusLabelVi).toContain('còn 4 ván');
    expect(getActiveBehaviorParams('nong', tiltedState)).toEqual(NONG_TILT_BEHAVIOR_PARAMS);
  });

  it('B4: selects 9 distinct rivals and shuffles seat order via Rng.fork(label) at a 10-player table without mutating chip state', () => {
    const rng = createRng('b4-10-player-table');
    const selection = selectRivalsForTable({
      rng,
      totalPlayers: 10,
      heroSeatIndex: 0,
      enabledRivalIds: RIVAL_IDS,
    });

    expect(selection.ok).toBe(true);
    if (!selection.ok) throw new Error('Expected valid rival selection');

    expect(selection.rivalIds).toHaveLength(9);
    expect(new Set(selection.rivalIds).size).toBe(9);
    expect([...selection.rivalIds].sort()).toEqual([...RIVAL_IDS].sort());
    expect(selection.assignments).toHaveLength(9);
    expect(selection.assignments.map((a) => a.seatIndex)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    for (const assignment of selection.assignments) {
      expect(assignment.metadata.rivalId).toBe(assignment.rivalId);
      expect(assignment.metadata.styleLabel.length).toBeGreaterThan(0);
    }

    // Determinism check: same seed produces identical seat assignments; different seed shuffles order
    const sameSeedSelection = selectRivalsForTable({
      rng: createRng('b4-10-player-table'),
      totalPlayers: 10,
      heroSeatIndex: 0,
    });
    expect(sameSeedSelection).toEqual(selection);

    const otherSeedSelection = selectRivalsForTable({
      rng: createRng('b4-10-player-table-different'),
      totalPlayers: 10,
      heroSeatIndex: 0,
    });
    expect(otherSeedSelection.ok).toBe(true);
    if (otherSeedSelection.ok) {
      expect(otherSeedSelection.rivalIds).not.toEqual(selection.rivalIds);
    }

    // Seat all 9 rivals + hero in a real 10-player hand and verify INV-1 and INV-2
    const dist = initialDistribution(10);
    expect(checkInv1([dist.bank, ...Array.from({ length: 10 }, () => dist.perPlayer)])).toEqual({
      ok: true,
    });

    const seats = [
      { seatIndex: 0, playerId: 'hero', stack: dist.perPlayer },
      ...selection.assignments.map((a) => ({
        seatIndex: a.seatIndex,
        playerId: a.rivalId,
        stack: dist.perPlayer,
      })),
    ];

    const started = startHand({
      seats,
      bank: dist.bank,
      rng: createRng('b4-hand-start'),
    });
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.message);
    const inv = checkHandInvariants(started.state);
    expect(inv.inv1).toEqual({ ok: true });
    expect(inv.inv2.ok).toBe(true);
  });

  it('filters strictly by enabledRivalIds and rejects insufficient or invalid pools clearly', () => {
    const enabledSubset = ['cao', 'soi', 'dien', 'bay', 'nong'] as const;
    const rng = createRng('subset-pool-seed');

    const res = selectRivalsForTable({
      rng,
      totalPlayers: 5, // needs 4 rivals
      heroSeatIndex: 2,
      enabledRivalIds: enabledSubset,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('Expected subset selection to succeed');
    expect(res.rivalIds).toHaveLength(4);
    expect(new Set(res.rivalIds).size).toBe(4);
    for (const id of res.rivalIds) {
      expect(enabledSubset).toContain(id);
    }
    expect(res.assignments.map((a) => a.seatIndex)).toEqual([0, 1, 3, 4]);

    // Insufficient pool: needs 6 rivals, only 5 enabled
    const insufficient = selectRivalsForTable({
      rng,
      totalPlayers: 7,
      enabledRivalIds: enabledSubset,
    });
    expect(insufficient).toEqual({
      ok: false,
      code: 'insufficient-rival-pool',
      message: expect.stringContaining('5'),
    });

    // Duplicate ID in enabled pool
    const duplicatePool = selectRivalsForTable({
      rng,
      rivalCount: 3,
      enabledRivalIds: ['da', 'ca', 'da', 'cao'],
    });
    expect(duplicatePool.ok).toBe(false);
    if (!duplicatePool.ok) {
      expect(duplicatePool.code).toBe('duplicate-rival-id-in-pool');
    }

    // Invalid rival ID in pool
    const invalidIdPool = selectRivalsForTable({
      rng,
      rivalCount: 3,
      enabledRivalIds: ['da', 'ca', 'unknown-bot' as never],
    });
    expect(invalidIdPool.ok).toBe(false);
    if (!invalidIdPool.ok) {
      expect(invalidIdPool.code).toBe('invalid-rival-id');
    }

    // Invalid player count
    const invalidCount = selectRivalsForTable({
      rng,
      totalPlayers: 11,
    });
    expect(invalidCount.ok).toBe(false);
    if (!invalidCount.ok) {
      expect(invalidCount.code).toBe('invalid-seat-count');
    }

    // Invalid seat indices
    const invalidSeats = selectRivalsForTable({
      rng,
      rivalCount: 3,
      seatIndices: [1, 1, 2],
    });
    expect(invalidSeats.ok).toBe(false);
    if (!invalidSeats.ok) {
      expect(invalidSeats.code).toBe('invalid-seat-indices');
    }
  });

  it('B4 regression: validates totalPlayers whenever supplied, rejects rivalCount exceeding available non-hero seats, and preserves subsets/sparse indices with 1:1 assignments', () => {
    // 1. Exact reproduction: rivalCount=5 with totalPlayers=4 must error, not return 5 IDs with 3 assignments
    const tooManyForTable = selectRivalsForTable({
      rng: createRng('s1'),
      rivalCount: 5,
      totalPlayers: 4,
    });
    expect(tooManyForTable.ok).toBe(false);
    if (!tooManyForTable.ok) {
      expect(tooManyForTable.code).toBe('invalid-seat-count');
    }

    // 2. Explicit seatIndices count > totalPlayers - 1 must also error
    const tooManyExplicitIndices = selectRivalsForTable({
      rng: createRng('s1-explicit-overflow'),
      totalPlayers: 4,
      seatIndices: [1, 2, 3, 4],
    });
    expect(tooManyExplicitIndices.ok).toBe(false);
    if (!tooManyExplicitIndices.ok) {
      expect(tooManyExplicitIndices.code).toBe('invalid-seat-count');
    }

    // 3. Invalid totalPlayers (outside 4..10 or non-integer) must error even when rivalCount or seatIndices is supplied
    for (const badTotal of [3, 11, 4.5]) {
      const badWithRivalCount = selectRivalsForTable({
        rng: createRng('s1-bad-total'),
        rivalCount: 2,
        totalPlayers: badTotal,
      });
      expect(badWithRivalCount.ok).toBe(false);
      if (!badWithRivalCount.ok) {
        expect(badWithRivalCount.code).toBe('invalid-seat-count');
      }

      const badWithIndices = selectRivalsForTable({
        rng: createRng('s1-bad-total-idx'),
        seatIndices: [1, 2],
        totalPlayers: badTotal,
      });
      expect(badWithIndices.ok).toBe(false);
      if (!badWithIndices.ok) {
        expect(badWithIndices.code).toBe('invalid-seat-count');
      }
    }

    // 4. Preserve smaller requested subset (rivalCount < totalPlayers - 1)
    const smallerSubset = selectRivalsForTable({
      rng: createRng('s1-smaller-subset'),
      rivalCount: 3,
      totalPlayers: 6,
      heroSeatIndex: 1,
    });
    expect(smallerSubset.ok).toBe(true);
    if (!smallerSubset.ok) throw new Error(smallerSubset.message);
    expect(smallerSubset.rivalIds).toHaveLength(3);
    expect(smallerSubset.assignments).toHaveLength(3);
    expect(smallerSubset.assignments.map((a) => a.seatIndex)).toEqual([0, 2, 3]);

    // 5. Preserve selection with only rivalCount
    const onlyCount = selectRivalsForTable({
      rng: createRng('s1-only-count'),
      rivalCount: 4,
    });
    expect(onlyCount.ok).toBe(true);
    if (!onlyCount.ok) throw new Error(onlyCount.message);
    expect(onlyCount.rivalIds).toHaveLength(4);
    expect(onlyCount.assignments).toHaveLength(4);
    expect(onlyCount.assignments.map((a) => a.seatIndex)).toEqual([1, 2, 3, 4]);

    // 6. Preserve valid explicit physical seat indices for sparse tables and verify INV-1/INV-2 on a real hand
    const sparseSeats = selectRivalsForTable({
      rng: createRng('s1-sparse-seats'),
      totalPlayers: 4,
      rivalCount: 3,
      seatIndices: [2, 5, 9],
      heroSeatIndex: 0,
    });
    expect(sparseSeats.ok).toBe(true);
    if (!sparseSeats.ok) throw new Error(sparseSeats.message);
    expect(sparseSeats.rivalIds).toHaveLength(3);
    expect(sparseSeats.assignments).toHaveLength(3);
    expect(sparseSeats.assignments.map((a) => a.seatIndex)).toEqual([2, 5, 9]);
    expect(sparseSeats.assignments.map((a) => a.rivalId)).toEqual([...sparseSeats.rivalIds]);

    const dist4 = initialDistribution(4);
    expect(checkInv1([dist4.bank, ...Array.from({ length: 4 }, () => dist4.perPlayer)])).toEqual({
      ok: true,
    });
    const sparseHand = startHand({
      seats: [
        { seatIndex: 0, playerId: 'hero', stack: dist4.perPlayer },
        ...sparseSeats.assignments.map((a) => ({
          seatIndex: a.seatIndex,
          playerId: a.rivalId,
          stack: dist4.perPlayer,
        })),
      ],
      bank: dist4.bank,
      rng: createRng('s1-sparse-hand'),
    });
    expect(sparseHand.ok).toBe(true);
    if (!sparseHand.ok) throw new Error(sparseHand.message);
    const inv = checkHandInvariants(sparseHand.state);
    expect(inv.inv1).toEqual({ ok: true });
    expect(inv.inv2.ok).toBe(true);
  });
});
