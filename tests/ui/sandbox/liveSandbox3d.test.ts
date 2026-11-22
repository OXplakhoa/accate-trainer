import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSandbox3d } from '../../../src/ui/liveSandbox3d/LiveSandbox3d';
import { toLiveSceneSnapshot } from '../../../src/ui/liveSandbox3d/snapshot';
import { SandboxApp } from '../../../src/ui/sandbox/SandboxApp';
import {
  createSandboxSession,
  enterHandBoundary,
  performHeroAction,
  stepOneBotTurn,
} from '../../../src/ui/sandbox/controller';
import { formatCardShort } from '../../../src/ui/sandbox/format';
import { HERO_PLAYER_ID, type SandboxTableView } from '../../../src/ui/sandbox/types';

vi.mock('../../../src/ui/sandbox/controller', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/sandbox/controller')>();
  return {
    ...actual,
    createSandboxSession: vi.fn(actual.createSandboxSession),
  };
});

describe('live Sandbox table integration', () => {
  beforeEach(() => { vi.spyOn(globalThis.performance, 'now').mockReturnValue(0); });
  afterEach(() => { vi.restoreAllMocks(); });
  it('passes the real seeded public table and Hero cards to the optional slot', () => {
    let view: SandboxTableView | undefined;
    const html = renderToStaticMarkup(createElement(SandboxApp, {
      initialSeed: 'live-table-test',
      initialSettings: { playerCount: 4, enabledRivalIds: ['ca', 'cao', 'nong'] },
      storage: null,
      renderTableView: (snapshot) => {
        view = snapshot;
        return createElement('div', { 'data-test-table': 'live' });
      },
    }));
    expect(view).toBeDefined();
    const session = createSandboxSession({
      seed: 'live-table-test',
      settings: { playerCount: 4, enabledRivalIds: ['ca', 'cao', 'nong'] },
    });
    expect(view?.board).toEqual(session.hand?.board.map(formatCardShort));
    expect(view?.heroCards).toHaveLength(2);
    expect(view?.occupiedRivals.slice().sort()).toEqual(['ca', 'cao', 'nong']);
    expect(view?.pot).toBeGreaterThan(0);
    expect(view?.street).toBe(session.hand?.street);
    expect(Object.keys(view ?? {})).not.toContain('hand');
    expect(html).toContain('data-test-table="live"');
    expect(html).not.toContain('class="sb-board"');
    expect(html).toContain('Lượt hiện tại:');
    expect(html).toContain('Sổ phiên');
    expect(html).toContain('Đổi chip');
  });

  it('maps live values and only supported occupied rivals, including boundary state', () => {
    const view: SandboxTableView = {
      potChips: { 5: 0, 10: 3, 50: 0, 100: 2 }, handNumber: 1, timelineLength: 2, seats: [], payoutTransfers: [],
      pot: 230, call: 25, heroCards: ['A♥', '10♠'],
      board: ['2♣', '3♦', '4♥', '5♠', '6♣'], street: 'river',
      occupiedRivals: ['ca', 'nong', 'da'], activeRival: 'nong',
      activePlayerName: 'Nóng', reducedMotion: true,
    };
    expect(toLiveSceneSnapshot(view)).toEqual({
      pot: 230, call: 25, heroCards: view.heroCards, board: view.board,
      live: { potChips: view.potChips, handNumber: 1, timelineLength: 2, seats: [], payoutTransfers: [], street: 'river', occupiedRivals: ['ca', 'nong'], activeRival: 'nong', activePlayerName: 'Nóng' },
    });
    const boundary = toLiveSceneSnapshot({
      ...view, pot: 0, call: 0, heroCards: [], board: [], street: null,
      occupiedRivals: ['cao'], activeRival: null, activePlayerName: null,
    });
    expect(boundary.live).toEqual({ potChips: view.potChips, handNumber: 1, timelineLength: 2, seats: [], payoutTransfers: [], street: null, occupiedRivals: ['cao'], activeRival: null, activePlayerName: null });
    expect(boundary.board).toEqual([]);
  });

  it('keeps the original view by default and isolates the prototype settings entry', () => {
    const original = renderToStaticMarkup(createElement(SandboxApp, { initialSeed: 'live-table-test', storage: null }));
    expect(original).toContain('class="sb-board"');
    expect(original).toContain('Cài đặt');
    const live = renderToStaticMarkup(createElement(LiveSandbox3d, { initialSeed: 'live-table-test' }));
    expect(live).toContain('drill3d-scene');
    expect(live).not.toContain('Cài đặt</button>');
    expect(live).toContain('Sổ phiên');
    expect(live).toContain('Âm thanh: Bật');
  });

  it('omits empty sb-pot-display when renderTableView is active and pot is 0 while keeping original Sandbox unchanged', () => {
    let s = createSandboxSession({
      seed: 'pot-zero-boundary-test',
      settings: { playerCount: 4, enabledRivalIds: ['ca', 'cao', 'nong'] },
    });
    let guard = 0;
    while (s.phase === 'in-hand' && s.hand?.phase === 'betting' && guard < 100) {
      if (s.hand.activePlayerId === HERO_PLAYER_ID) {
        s = performHeroAction(s, 'fold');
      } else {
        s = stepOneBotTurn(s);
      }
      guard++;
    }
    const boundarySession = enterHandBoundary(s);
    expect(boundarySession.phase).toBe('between-hands');
    expect(boundarySession.boundary).not.toBeNull();

    const mockedCreate = vi.mocked(createSandboxSession);
    mockedCreate.mockReturnValueOnce(boundarySession);
    const livePotZeroHtml = renderToStaticMarkup(
      createElement(SandboxApp, {
        initialSeed: 'pot-zero-boundary-test',
        storage: null,
        renderTableView: (snapshot) =>
          createElement('div', { 'data-test-table': 'live', 'data-pot': String(snapshot.pot) }),
      }),
    );
    expect(livePotZeroHtml).toContain('data-pot="0"');
    expect(livePotZeroHtml).not.toContain('class="sb-pot-display"');

    mockedCreate.mockReturnValueOnce(boundarySession);
    const originalPotZeroHtml = renderToStaticMarkup(
      createElement(SandboxApp, {
        initialSeed: 'pot-zero-boundary-test',
        storage: null,
      }),
    );
    expect(originalPotZeroHtml).toContain('class="sb-pot-display"');
    expect(originalPotZeroHtml).toContain('class="sb-pot-display__main"');
  });
});
