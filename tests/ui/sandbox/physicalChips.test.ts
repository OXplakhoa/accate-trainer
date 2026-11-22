import { describe, expect, it, vi } from 'vitest';
import { chipValue, DENOMINATIONS } from '../../../src/engine';
import { buildChipStacks, buildChipStacksForAmount } from '../../../src/ui/drill3d/scene/outs';
import { drawSuitSymbol } from '../../../src/ui/drill3d/scene/textures';
import { toLiveSceneSnapshot } from '../../../src/ui/liveSandbox3d/snapshot';
import { buildSandboxTableView } from '../../../src/ui/sandbox/tableView';
import { createSandboxSession, isSeatCardsRevealed, performHeroAction, stepOneBotTurn } from '../../../src/ui/sandbox/controller';

vi.mock('three', () => ({}));

const settings = { playerCount: 4, enabledRivalIds: ['ca', 'cao', 'nong'] as const };

describe('physical chips and public view', () => {
  it('splits every physical chip into columns and uses only game denominations', () => {
    const call = buildChipStacksForAmount(35);
    expect(call.map(s => [s.denom.value, s.count])).toEqual([[10, 3], [5, 1]]);
    const counts = { 5: 100, 10: 100, 50: 50, 100: 25 };
    const stacks = buildChipStacks(counts);
    expect(stacks.every(s => s.count <= 10 && DENOMINATIONS.some(d => d === s.denom.value))).toBe(true);
    for (const d of DENOMINATIONS) expect(stacks.filter(s => s.denom.value === d).reduce((n, s) => n + s.count, 0)).toBe(counts[d]);
    expect(buildChipStacksForAmount(6500).reduce((n, s) => n + s.count * s.denom.value, 0)).toBe(6500);
  });

  it('exposes engine pot and payout chips and applies the existing visibility guard throughout a seeded hand and fold-win', () => {
    let session = createSandboxSession({ seed: 'sandbox3d-1', settings });
    for (let i = 0; i < 100 && session.hand; i++) {
      const hand = session.hand;
      const view = buildSandboxTableView(session, 0, false);
      const snapshot = toLiveSceneSnapshot(view);
      expect(view.potChips).toEqual(hand.pot);
      expect(snapshot.live?.potChips).toEqual(hand.pot);
      expect(view.payoutTransfers).toEqual(hand.settledTransfers.map(t => ({ seatId: t.playerId, chips: t.chips })));
      for (const seat of view.seats) {
        expect(seat.revealedCards !== null).toBe(isSeatCardsRevealed(hand, seat.id));
        expect(snapshot.live?.seats.find(s => s.id === seat.id)?.revealedCards).toEqual(seat.revealedCards);
        if (hand.phase === 'betting') expect(chipValue(seat.streetChips)).toBe(hand.seats.find(s => s.playerId === seat.id)?.streetContribution);
      }
      if (hand.phase !== 'betting') break;
      session = hand.activePlayerId === 'hero' ? performHeroAction(session, 'fold') : stepOneBotTurn(session);
    }
    expect(session.hand?.outcome?.kind).toBe('showdown');
    const hand = session.hand!;
    const folded = { ...session, hand: { ...hand, outcome: { kind: 'fold-win' as const, winnerId: 'ca', potAmount: 0, revealedCards: false as const } } };
    const view = buildSandboxTableView(folded, 0, false);
    expect(view.seats.filter(s => s.id !== 'hero').every(s => s.revealedCards === null)).toBe(true);
    expect(toLiveSceneSnapshot(view).live?.seats.filter(s => s.id !== 'hero').every(s => s.revealedCards === null)).toBe(true);
  });

  it('draws each club lobe in a separate closed path', () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_, key) => () => { calls.push(String(key)); }, set: () => true }) as CanvasRenderingContext2D;
    drawSuitSymbol(ctx, '♣', 0, 0, 10, '#000');
    expect(calls.filter(c => c === 'arc')).toHaveLength(3);
    const arcs = calls.map((c, i) => c === 'arc' ? i : -1).filter(i => i >= 0);
    expect(calls.slice(arcs[0]! + 1, arcs[1])).toContain('beginPath');
    expect(calls.slice(arcs[1]! + 1, arcs[2])).toContain('beginPath');
    expect(calls.filter(c => c === 'closePath')).toHaveLength(4);
    vi.clearAllMocks();
  });
});



