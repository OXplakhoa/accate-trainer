import type { SceneRival, SceneTableSnapshot } from '../drill3d/contract';
import type { SandboxTableView } from '../sandbox/types';

function isSceneRival(id: string): id is SceneRival {
  return id === 'ca' || id === 'cao' || id === 'nong';
}

export function toLiveSceneSnapshot(view: SandboxTableView): SceneTableSnapshot {
  return {
    pot: view.pot,
    call: view.call,
    heroCards: view.heroCards,
    board: view.board,
    live: {
      potChips: view.potChips,
      handNumber: view.handNumber,
      timelineLength: view.timelineLength,
      dealerSeatId: view.dealerSeatId,
      seats: view.seats,
      payoutTransfers: view.payoutTransfers,
      street: view.street,
      occupiedRivals: view.occupiedRivals.filter(isSceneRival),
      activeRival: view.activeRival && isSceneRival(view.activeRival) ? view.activeRival : null,
      activePlayerName: view.activePlayerName,
    },
  };
}
