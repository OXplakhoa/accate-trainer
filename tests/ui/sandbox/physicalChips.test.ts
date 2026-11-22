import { describe, expect, it, vi } from 'vitest';
import { chipValue, DENOMINATIONS } from '../../../src/engine';
import { buildChipStacks, buildChipStacksForAmount } from '../../../src/ui/drill3d/scene/outs';
import { drawSuitSymbol } from '../../../src/ui/drill3d/scene/textures';
import { toLiveSceneSnapshot } from '../../../src/ui/liveSandbox3d/snapshot';
import { buildSandboxTableView } from '../../../src/ui/sandbox/tableView';
import { createSandboxSession, enterHandBoundary, getHeroActionValidation, isSeatCardsRevealed, performHeroAction, stageChip, startNextHand, stepOneBotTurn } from '../../../src/ui/sandbox/controller';

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

  it('clears public hand fields between hands', () => {
    let session = createSandboxSession({ seed: 'pot-zero-boundary-test', settings });
    for (let i = 0; i < 100 && session.hand?.phase === 'betting'; i++) {
      session = session.hand.activePlayerId === 'hero' ? performHeroAction(session, 'fold') : stepOneBotTurn(session);
    }
    session = enterHandBoundary(session);
    expect(session.phase).toBe('between-hands');
    expect(session.boundary).not.toBeNull();
    const boundary = session.boundary!;
    const seats = boundary.seats.map((seat, i) => i === 0 ? { ...seat, stack: { 5: 0, 10: 0, 50: 0, 100: 0 } } : seat);
    const view = buildSandboxTableView({ ...session, boundary: { ...boundary, seats } }, 0, false);
    const zero = { 5: 0, 10: 0, 50: 0, 100: 0 };
    expect(view.potChips).toEqual(zero);
    expect(view.payoutTransfers).toEqual([]);
    expect(view.seats.length).toBeGreaterThan(1);
    for (const seat of view.seats) {
      expect(seat.streetChips).toEqual(zero);
      expect(seat.revealedCards).toBeNull();
      expect(seat.isActor).toBe(false);
      expect(seat.isWinner).toBe(false);
      expect(seat.status).toBe(chipValue(seat.stackChips) === 0 ? 'out' : 'active');
    }
    expect(view.seats.some(seat => seat.status === 'out')).toBe(true);
    expect(view.seats.some(seat => seat.status === 'active')).toBe(true);
    expect(view.dealerSeatId).toBeNull();
  });

  it('exposes dealerSeatId from hand.dealerSeatIndex, rotates across hands, and clears between hands', () => {
    let session = createSandboxSession({ seed: 'sandbox3d-1', settings });
    const hand1View = buildSandboxTableView(session, 0, false);
    const hand1Dealer = session.hand!.seats.find(s => s.seatIndex === session.hand!.dealerSeatIndex)!.playerId;
    expect(hand1View.dealerSeatId).toBe(hand1Dealer);
    expect(toLiveSceneSnapshot(hand1View).live?.dealerSeatId).toBe(hand1Dealer);

    for (let i = 0; i < 100 && session.hand?.phase === 'betting'; i++) {
      session = session.hand.activePlayerId === 'hero' ? performHeroAction(session, 'fold') : stepOneBotTurn(session);
    }
    const boundary = enterHandBoundary(session);
    const boundaryView = buildSandboxTableView(boundary, 0, false);
    expect(boundaryView.dealerSeatId).toBeNull();
    expect(toLiveSceneSnapshot(boundaryView).live?.dealerSeatId).toBeNull();

    const hand2 = startNextHand(boundary);
    const hand2View = buildSandboxTableView(hand2, 0, false);
    const hand2Dealer = hand2.hand!.seats.find(s => s.seatIndex === hand2.hand!.dealerSeatIndex)!.playerId;
    expect(hand2View.dealerSeatId).toBe(hand2Dealer);
    expect(hand2View.dealerSeatId).not.toBe(hand1View.dealerSeatId);
    expect(toLiveSceneSnapshot(hand2View).live?.dealerSeatId).toBe(hand2Dealer);
  });

  it('tracks seat actions and resets physical street chips on the flop', () => {
    let session = createSandboxSession({ seed: 'sandbox3d-1', settings: { ...settings, enablePreflopBetting: true } });
    let sawActionChips = false;
    let sawFold = false;
    for (let i = 0; i < 100 && session.hand?.phase === 'betting' && session.hand.street === 'preflop'; i++) {
      const hand = session.hand;
      const view = buildSandboxTableView(session, 0, false);
      expect(view.handNumber).toBe(session.handNumber);
      expect(view.seats.map(seat => seat.id)).toEqual([...hand.seats].sort((a, b) => a.seatIndex - b.seatIndex).map(seat => seat.playerId));
      for (const seat of view.seats) {
        expect(seat.isActor).toBe(hand.activePlayerId === seat.id);
        const engineSeat = hand.seats.find(s => s.playerId === seat.id)!;
        expect(seat.status).toBe(engineSeat.status);
        if (seat.status === 'folded') sawFold = true;
        const events = hand.timeline.filter(e => e.type === 'player-action' && e.street === hand.street && e.playerId === seat.id);
        const last = events.at(-1);
        if (last?.type === 'player-action') expect(seat.lastAction).toEqual({ type: last.action.type, amount: last.addedAmount });
        if (chipValue(seat.streetChips) > 0) sawActionChips = true;
      }
      if (hand.activePlayerId !== 'hero') session = stepOneBotTurn(session);
      else {
        const validation = getHeroActionValidation(session);
        if (validation.canCheck) session = performHeroAction(session, 'check');
        else {
          let remaining = validation.callAmount ?? 0;
          let staged = session;
          const hero = hand.seats.find(seat => seat.playerId === 'hero')!;
          for (const d of [100, 50, 10, 5] as const) {
            const count = Math.min(hero.stack[d], Math.floor(remaining / d));
            for (let n = 0; n < count; n++) staged = stageChip(staged, d);
            remaining -= count * d;
          }
          session = remaining === 0 && getHeroActionValidation(staged).canConfirmCall ? performHeroAction(staged, 'call') : performHeroAction(session, 'fold');
        }
      }
    }
    expect(sawActionChips).toBe(true);
    expect(sawFold).toBe(true);
    expect(session.hand?.street).toBe('flop');
    for (const seat of buildSandboxTableView(session, 0, false).seats) expect(seat.streetChips).toEqual({ 5: 0, 10: 0, 50: 0, 100: 0 });
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
