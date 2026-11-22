import { addChips, chipValue, DENOMINATIONS, emptyChips, subtractChips } from '../../engine';
import { isSeatCardsRevealed } from './controller';
import { formatCardShort, getPlayerName } from './format';
import type { SandboxSessionState, SandboxTableView, TableSeatId } from './types';

function seatId(id: string): id is TableSeatId {
  return id === 'hero' || id === 'ca' || id === 'cao' || id === 'nong';
}

/** Builds only public information, plus Hero's own cards. */
export function buildSandboxTableView(session: SandboxSessionState, call: number, reducedMotion: boolean): SandboxTableView {
  const hand = session.phase === 'in-hand' ? session.hand : null;
  const actor = hand?.phase === 'betting' ? hand.activePlayerId : null;
  const seats = hand?.seats ?? session.boundary?.seats ?? [];
  const dealerPlayerId = hand ? (hand.seats.find(s => s.seatIndex === hand.dealerSeatIndex)?.playerId ?? null) : null;
  const dealerSeatId: TableSeatId | null = dealerPlayerId && seatId(dealerPlayerId) ? dealerPlayerId : null;
  return {
    pot: chipValue(hand?.pot ?? emptyChips()),
    potChips: hand?.pot ?? emptyChips(),
    handNumber: session.handNumber,
    timelineLength: hand?.timeline.length ?? 0,
    dealerSeatId,
    call,
    reducedMotion,
    heroCards: hand?.seats.find(s => s.playerId === 'hero')?.holeCards.map(formatCardShort) ?? [],
    board: hand?.board.map(formatCardShort) ?? [],
    street: hand?.street ?? null,
    occupiedRivals: seats.flatMap(s => { const rival = session.seatProfiles[s.playerId]?.rivalId; return rival ? [rival] : []; }),
    activeRival: actor ? session.seatProfiles[actor]?.rivalId ?? null : null,
    activePlayerName: actor ? getPlayerName(actor, session.seatProfiles) : null,
    seats: [...seats].sort((a, b) => a.seatIndex - b.seatIndex).flatMap(seat => {
      if (!seatId(seat.playerId)) return [];
      const inHand = hand?.seats.find(s => s.playerId === seat.playerId);
      let streetChips = emptyChips();
      let lastAction: SandboxTableView['seats'][number]['lastAction'] = null;
      for (const event of hand?.timeline ?? []) {
        if (event.type === 'player-action' && event.street === hand?.street && event.playerId === seat.playerId) {
          if ('chips' in event.action) streetChips = addChips(streetChips, event.action.chips);
          lastAction = {
            type: event.action.type,
            amount: event.addedAmount,
          };
        }
        if (event.type === 'uncalled-refund' && event.street === hand?.street && event.playerId === seat.playerId && DENOMINATIONS.every(d => streetChips[d] >= event.chips[d])) {
          streetChips = subtractChips(streetChips, event.chips);
        }
      }
      return [{
        id: seat.playerId,
        stackChips: seat.stack,
        streetChips,
        status: inHand?.status ?? (chipValue(seat.stack) === 0 ? 'out' as const : 'active' as const),
        lastAction,
        isActor: actor === seat.playerId,
        isWinner: hand?.outcome?.kind === 'fold-win' ? hand.outcome.winnerId === seat.playerId : (hand?.outcome?.kind === 'showdown' && hand.outcome.resolution.totalPayouts.some(p => p.playerId === seat.playerId && p.amount > 0)),
        revealedCards: inHand && hand && isSeatCardsRevealed(hand, seat.playerId) ? inHand.holeCards.map(formatCardShort) : null,
      }];
    }),
    payoutTransfers: (hand?.settledTransfers ?? []).flatMap(t => seatId(t.playerId) ? [{
      seatId: t.playerId,
      chips: t.chips,
    }] : []),
  };
}
