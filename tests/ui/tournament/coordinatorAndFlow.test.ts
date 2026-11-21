import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkHandInvariants,
  checkInv1,
  chipValue,
  emptyChips,
  type HandState,
} from '../../../src/engine';
import {
  applySettingsUpdate,
  createSandboxSession,
  enterHandBoundary,
  exchangeInHand,
  getHeroActionValidation,
  getHeroTurnIdentity,
  HERO_PLAYER_ID,
  performHeroAction,
  performHeroAutoTimeout,
  performHeroOutOfTurn,
  rebuyPlayerAtBoundary,
  SandboxAudioEngine,
  stageChip,
  startNextHand,
  stepOneBotTurn,
  verifySessionInvariants,
  type DealAnimationEndInfo,
  type SandboxExternalApi,
  type SandboxSessionState,
} from '../../../src/ui/sandbox';
import {
  syncDealAnimationLifecycle,
  type DealAnimState,
  type PendingDealDescriptor,
} from '../../../src/ui/sandbox/dealAnimation';
import {
  computeTurnKey,
  TournamentClockDriver,
} from '../../../src/ui/tournament';

const DEAL_MS = 320;

interface ScheduledTimer {
  readonly id: number;
  readonly dueAt: number;
  readonly callback: () => void;
  cleared: boolean;
  fired: boolean;
}

function createFakeClock() {
  let currentMs = 0;
  let nextId = 1;
  const timers: ScheduledTimer[] = [];

  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
    const entry: ScheduledTimer = {
      id: nextId++,
      dueAt: currentMs + (ms ?? 0),
      callback: cb,
      cleared: false,
      fired: false,
    };
    timers.push(entry);
    return entry.id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof globalThis.setTimeout);

  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((
    id?: ReturnType<typeof setTimeout>,
  ) => {
    const numericId = id as unknown as number;
    const found = timers.find((t) => t.id === numericId);
    if (found) {
      found.cleared = true;
    }
  }) as typeof globalThis.clearTimeout);

  const advance = (ms: number) => {
    const target = currentMs + ms;
    for (;;) {
      const nextDue = timers
        .filter((t) => !t.cleared && !t.fired && t.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
      if (!nextDue) {
        break;
      }
      currentMs = nextDue.dueAt;
      nextDue.fired = true;
      nextDue.callback();
    }
    currentMs = target;
  };

  return {
    now: () => currentMs,
    advance,
  };
}

type FakeClock = ReturnType<typeof createFakeClock>;

function assertAllInvariants(session: SandboxSessionState, label: string): void {
  const report = verifySessionInvariants(session);
  expect(report.ok, `${label}: ${report.detail}`).toBe(true);
  if (session.phase === 'in-hand' && session.hand !== null) {
    const handReport = checkHandInvariants(session.hand);
    expect(handReport.ok, `${label} hand invariants`).toBe(true);
  } else if (session.phase === 'between-hands' && session.boundary !== null) {
    const inv1 = checkInv1([
      session.boundary.bank,
      ...session.boundary.seats.map((s) => s.stack),
    ]);
    expect(inv1.ok, `${label} boundary INV-1`).toBe(true);
  }
}

interface HarnessOptions {
  readonly session: SandboxSessionState;
  readonly clock: FakeClock;
  readonly audio?: SandboxAudioEngine;
  readonly active?: boolean;
}

/**
 * Deterministic Tournament integration harness wiring:
 * - Real Sandbox session controller (`createSandboxSession`, `performHeroAction`, `performHeroAutoTimeout`, etc.)
 * - Real `syncDealAnimationLifecycle` (320ms deal/reveal + reduced motion + superseded)
 * - Real `TournamentClockDriver` + deterministic fake clock
 * - Optional `SandboxAudioEngine` on the `'timer'` channel
 */
function createTournamentHarness(options: HarnessOptions) {
  let session = options.session;
  assertAllInvariants(session, 'initial');

  let autoTimeoutCalls = 0;
  const tickCalls: Array<{ urgent: boolean }> = [];
  const dealEvents: DealAnimationEndInfo[] = [];

  let dealGeneration = 1;
  let dealAnimState: DealAnimState = 'idle';
  const pendingDealRef: { current: PendingDealDescriptor | null } = { current: null };
  const completedDealKeyRef: { current: string | null } = { current: null };
  let activeDealCleanup: (() => void) | undefined;

  const driver = new TournamentClockDriver({
    initialDurationSeconds: session.appliedSettings.tournamentTimerSeconds,
    initialReducedMotion: session.appliedSettings.reducedMotion,
    initialActive: options.active ?? true,
    now: options.clock.now,
  });

  const onDealAnimationEndRef: {
    current: ((info: DealAnimationEndInfo) => void) | undefined;
  } = {
    current: (info) => {
      dealEvents.push(info);
      driver.handleDealAnimationEnd(info);
    },
  };

  const api: SandboxExternalApi = {
    getState: () => session,
    getDealGeneration: () => dealGeneration,
    autoTimeoutHeroAction: (expectedTurnKey?: string) => {
      autoTimeoutCalls += 1;
      const capturedGen = dealGeneration;
      const targetTurnKey =
        expectedTurnKey ?? getHeroTurnIdentity(session, capturedGen) ?? undefined;
      if (dealGeneration !== capturedGen) {
        return;
      }
      session = performHeroAutoTimeout(session, targetTurnKey, dealGeneration);
      assertAllInvariants(session, `after autoTimeout #${autoTimeoutCalls}`);
      syncEffects();
    },
    playTimerTick: (urgent = false) => {
      tickCalls.push({ urgent });
      options.audio?.playTimerTick(urgent);
    },
  };

  function getActiveDealKey(s: SandboxSessionState): string | null {
    if (s.phase !== 'in-hand' || s.hand === null) {
      return null;
    }
    return `${s.sessionSeed}:${s.handNumber}:${s.hand.street}:${s.hand.board.length}`;
  }

  function getDealKey(s: SandboxSessionState): string | null {
    const activeKey = getActiveDealKey(s);
    return activeKey !== null ? `${activeKey}:g${dealGeneration}` : null;
  }

  let lastEffectDealKey: string | null | undefined = undefined;
  let lastEffectReducedMotion: boolean | undefined = undefined;

  function syncEffects(): void {
    const dealKey = getDealKey(session);
    const reducedMotion = session.appliedSettings.reducedMotion;
    if (dealKey !== lastEffectDealKey || reducedMotion !== lastEffectReducedMotion) {
      lastEffectDealKey = dealKey;
      lastEffectReducedMotion = reducedMotion;
      activeDealCleanup?.();
      activeDealCleanup = syncDealAnimationLifecycle({
        dealKey,
        effectiveReducedMotion: reducedMotion,
        durationMs: DEAL_MS,
        getDealInfo: () => {
          if (session.phase !== 'in-hand' || session.hand === null) {
            return null;
          }
          return {
            handNumber: session.handNumber,
            street: session.hand.street,
            eventCount: session.hand.timeline.length,
            sessionSeed: session.sessionSeed,
            dealKey: `${session.sessionSeed}:${session.handNumber}:${session.hand.street}:${session.hand.board.length}`,
            dealGeneration,
          };
        },
        pendingDealRef,
        completedDealKeyRef,
        onDealAnimationEndRef,
        setDealAnimState: (next) => {
          dealAnimState = next;
        },
      });
    }
    driver.handleHeroTurnChange();
  }

  driver.setController(api);
  syncEffects();

  return {
    driver,
    getSession: () => session,
    getDealState: () => dealAnimState,
    getAutoTimeoutCalls: () => autoTimeoutCalls,
    getTickCalls: () => tickCalls,
    getDealEvents: () => dealEvents,
    getDealGeneration: () => dealGeneration,
    updateSession(updater: (prev: SandboxSessionState) => SandboxSessionState, label: string, resetDealCompleted = false) {
      if (resetDealCompleted) {
        completedDealKeyRef.current = null;
        dealGeneration += 1;
      }
      session = updater(session);
      assertAllInvariants(session, label);
      syncEffects();
      return session;
    },
    stepBot(label = 'bot step') {
      return this.updateSession((prev) => stepOneBotTurn(prev), label);
    },
    stepBotsUntilHeroOrEnd(maxSteps = 80) {
      let steps = 0;
      while (
        session.phase === 'in-hand' &&
        session.hand !== null &&
        session.hand.phase === 'betting' &&
        session.hand.activePlayerId !== HERO_PLAYER_ID &&
        steps < maxSteps
      ) {
        this.stepBot(`bot step ${steps}`);
        steps += 1;
      }
      return session;
    },
    heroStage(denom: 5 | 10 | 50 | 100) {
      return this.updateSession((prev) => stageChip(prev, denom), `stage ${denom}`);
    },
    heroAct(type: 'fold' | 'check' | 'call' | 'bet' | 'raise') {
      return this.updateSession((prev) => performHeroAction(prev, type), `hero ${type}`);
    },
    heroDeclareOot(type: 'check' | 'call' | 'bet' | 'raise') {
      return this.updateSession((prev) => performHeroOutOfTurn(prev, type), `hero oot ${type}`);
    },
    applySettings(next: SandboxSessionState['appliedSettings'], mode: 'apply-boundary' | 'new-session') {
      return this.updateSession(
        (prev) => applySettingsUpdate(prev, next, mode),
        `settings ${mode}`,
        mode === 'new-session',
      );
    },
    resetSession(seed: string, settings?: Partial<SandboxSessionState['appliedSettings']>) {
      return this.updateSession(
        (prev) =>
          createSandboxSession({
            seed,
            settings: settings ?? prev.appliedSettings,
            fixtures: { openerId: HERO_PLAYER_ID },
          }),
        `reset session ${seed}`,
        true,
      );
    },
    nextHand() {
      return this.updateSession((prev) => startNextHand(prev), 'next hand');
    },
    setActive(active: boolean) {
      driver.setActive(active);
    },
    cleanup() {
      activeDealCleanup?.();
      driver.dispose();
    },
  };
}

function createFakeAudioEnv() {
  const createdOscillators: Array<{
    freqCalls: Array<{ value: number; time: number }>;
    stopCalls: number;
  }> = [];

  class FakeAudioContext {
    public state = 'suspended';
    public currentTime = 0;
    public destination = {} as AudioNode;
    public resume = vi.fn(async () => {
      this.state = 'running';
    });
    public close = vi.fn(async () => {
      this.state = 'closed';
    });
    public createOscillator() {
      const oscRecord = {
        freqCalls: [] as Array<{ value: number; time: number }>,
        stopCalls: 0,
      };
      createdOscillators.push(oscRecord);
      return {
        type: 'sine',
        frequency: {
          value: 440,
          setValueAtTime: (value: number, time: number) => {
            oscRecord.freqCalls.push({ value, time });
          },
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(() => {
          oscRecord.stopCalls += 1;
        }),
        disconnect: vi.fn(),
      } as unknown as OscillatorNode;
    }
    public createGain() {
      return {
        gain: {
          value: 0,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
          setTargetAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as GainNode;
    }
    public createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: { value: 320 },
        connect: vi.fn(),
      } as unknown as BiquadFilterNode;
    }
  }

  return { FakeAudioContext, createdOscillators };
}

describe('P5 Tournament — Clock Synchronization, O1–O6, X7, Lifecycle & Invariants', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('O1: 20s default clock starts after deal animation, ticks last 3s, and auto-checks exactly once on timeout', () => {
    const clock = createFakeClock();
    const session = createSandboxSession({
      seed: 'p5-o1-seed',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const h = createTournamentHarness({ session, clock });

    // During deal animation (< 320ms), timer is waiting and does NOT count down
    expect(h.driver.getState().status).toBe('waiting-animation');
    expect(h.driver.getState().configuredDurationSeconds).toBe(20);
    clock.advance(319);
    expect(h.driver.getState().status).toBe('waiting-animation');
    expect(h.driver.getState().remainingSeconds).toBe(20);

    // At 320ms deal completes -> clock begins 20s countdown
    clock.advance(1);
    expect(h.driver.getState().status).toBe('running');
    expect(h.driver.getState().remainingSeconds).toBe(20);

    // Stage a 10-chip while thinking (must be returned on O1 check timeout too)
    h.heroStage(10);
    expect(chipValue(h.getSession().stagedChips)).toBe(10);

    // Advance 16s -> 4s left, no ticks yet
    clock.advance(16_000);
    expect(h.driver.getState().remainingSeconds).toBe(4);
    expect(h.getTickCalls()).toEqual([]);

    // Last 3 seconds: 3 -> 2 -> 1
    clock.advance(1_000);
    expect(h.driver.getState().remainingSeconds).toBe(3);
    expect(h.getTickCalls()).toEqual([{ urgent: false }]);

    clock.advance(1_000);
    expect(h.driver.getState().remainingSeconds).toBe(2);
    expect(h.getTickCalls()).toEqual([{ urgent: false }, { urgent: false }]);

    clock.advance(1_000);
    expect(h.driver.getState().remainingSeconds).toBe(1);
    expect(h.getTickCalls()).toEqual([
      { urgent: false },
      { urgent: false },
      { urgent: true },
    ]);

    // Timeout at 20s -> calls autoTimeoutHeroAction EXACTLY ONCE, checks, returns staged chips
    clock.advance(1_000);
    expect(h.getAutoTimeoutCalls()).toBe(1);
    expect(chipValue(h.getSession().stagedChips)).toBe(0);
    const heroCheckEv = h.getSession().hand!.timeline.find(
      (ev) => ev.type === 'player-action' && ev.playerId === HERO_PLAYER_ID,
    );
    expect(heroCheckEv?.type === 'player-action' && heroCheckEv.action.type).toBe('check');

    // Advancing further must NEVER fire a duplicate timeout for the ended turn
    clock.advance(30_000);
    expect(h.getAutoTimeoutCalls()).toBe(1);
    h.cleanup();
  });

  it('O2: facing a bet, timeout auto-folds once, returns staged chips to stack, and keeps prior pot contributions', () => {
    const clock = createFakeClock();
    const base = createSandboxSession({
      seed: 'p5-o2-seed',
      settings: {
        playerCount: 4,
        enabledRivalIds: ['dien', 'soi', 'ca'],
        allowOutOfTurn: false,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const h = createTournamentHarness({ session: base, clock });

    // Deal completes -> Hero bets 10 first (so Hero contributes 5 ante + 10 bet = 15)
    clock.advance(DEAL_MS);
    h.heroStage(10);
    h.heroAct('bet');

    // Bots act until Hero faces a raise (Điên/Sói will raise) or reach a spot facing bet
    h.stepBotsUntilHeroOrEnd();
    if (
      h.getSession().hand?.activePlayerId !== HERO_PLAYER_ID ||
      (getHeroActionValidation(h.getSession()).canCheck ?? true)
    ) {
      h.cleanup();
      const sDien = createSandboxSession({
        seed: 'p5-o2-dien-bet',
        settings: {
          playerCount: 4,
          enabledRivalIds: ['dien', 'da', 'ca'],
          allowOutOfTurn: false,
          tournamentTimerSeconds: 15,
        },
        fixtures: { openerId: 'dien' },
      });
      const h2 = createTournamentHarness({ session: sDien, clock });
      clock.advance(DEAL_MS);
      h2.stepBotsUntilHeroOrEnd();
      expect(h2.getSession().hand!.activePlayerId).toBe(HERO_PLAYER_ID);
      expect(getHeroActionValidation(h2.getSession()).canCheck).toBe(false);

      const heroSeatBefore = h2.getSession().hand!.seats.find((s) => s.playerId === HERO_PLAYER_ID)!;
      const stackBefore = chipValue(heroSeatBefore.stack);
      const potBefore = chipValue(h2.getSession().hand!.pot);

      h2.heroStage(10);
      h2.heroStage(10);
      expect(chipValue(h2.getSession().stagedChips)).toBe(20);

      clock.advance(15_000);
      expect(h2.getAutoTimeoutCalls()).toBe(1);
      expect(chipValue(h2.getSession().stagedChips)).toBe(0);

      const heroSeatAfter = h2.getSession().hand!.seats.find((s) => s.playerId === HERO_PLAYER_ID)!;
      expect(heroSeatAfter.status).toBe('folded');
      expect(chipValue(heroSeatAfter.stack)).toBe(stackBefore);
      expect(chipValue(h2.getSession().hand!.pot)).toBe(potBefore);
      h2.cleanup();
      return;
    }

    const heroSeatBefore = h.getSession().hand!.seats.find((s) => s.playerId === HERO_PLAYER_ID)!;
    const heroTotalBefore = heroSeatBefore.totalContribution;
    const stackBefore = chipValue(heroSeatBefore.stack);
    const potBefore = chipValue(h.getSession().hand!.pot);

    expect(heroTotalBefore).toBe(15);
    h.heroStage(10);
    h.heroStage(10);
    expect(chipValue(h.getSession().stagedChips)).toBe(20);

    clock.advance(20_000);
    expect(h.getAutoTimeoutCalls()).toBe(1);
    expect(chipValue(h.getSession().stagedChips)).toBe(0);

    const heroSeatAfter = h.getSession().hand!.seats.find((s) => s.playerId === HERO_PLAYER_ID)!;
    expect(heroSeatAfter.status).toBe('folded');
    expect(heroSeatAfter.totalContribution).toBe(heroTotalBefore);
    expect(chipValue(heroSeatAfter.stack)).toBe(stackBefore);
    const updatedHand = h.getSession().hand!;
    if (updatedHand.phase === 'complete') {
      expect(updatedHand.outcome?.kind).toBe('fold-win');
      if (updatedHand.outcome?.kind === 'fold-win') {
        expect(updatedHand.outcome.potAmount).toBe(potBefore);
        expect(updatedHand.outcome.winnerId).not.toBe(HERO_PLAYER_ID);
      }
    } else {
      expect(chipValue(updatedHand.pot)).toBe(potBefore);
    }

    clock.advance(20_000);
    expect(h.getAutoTimeoutCalls()).toBe(1);
    h.cleanup();
  });

  it('manual action right before deadline cancels timeout, mid-turn chip exchange does not reset clock, and next turn gets a fresh full clock', () => {
    const clock = createFakeClock();
    const session = createSandboxSession({
      seed: 'p5-near-deadline',
      settings: {
        playerCount: 4,
        enabledRivalIds: ['dien', 'da', 'ca'],
        allowOutOfTurn: false,
        tournamentTimerSeconds: 10,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const h = createTournamentHarness({ session, clock });

    clock.advance(DEAL_MS);
    expect(h.driver.getState().status).toBe('running');
    expect(h.driver.getState().remainingSeconds).toBe(10);

    clock.advance(6_000);
    expect(h.driver.getState().remainingSeconds).toBe(4);
    h.updateSession(
      (prev) =>
        exchangeInHand(prev, {
          fromPlayerId: HERO_PLAYER_ID,
          target: { kind: 'pot' },
          give: { 5: 0, 10: 2, 50: 0, 100: 0 },
          receive: { 5: 4, 10: 0, 50: 0, 100: 0 },
        }),
      'mid-turn chip exchange',
    );
    expect(h.driver.getState().status).toBe('running');
    expect(h.driver.getState().remainingSeconds).toBe(4);

    // 50ms left before timeout: Hero manually checks
    clock.advance(3_950);
    expect(h.driver.getState().remainingSeconds).toBe(1);
    h.heroAct('check');
    expect(h.driver.getState().status).toBe('idle');

    // Advancing past the old deadline must NOT trigger timeout
    clock.advance(200);
    expect(h.getAutoTimeoutCalls()).toBe(0);

    h.stepBotsUntilHeroOrEnd();
    if (h.getSession().hand!.street === 'turn') {
      expect(h.driver.getState().status).toBe('waiting-animation');
      clock.advance(DEAL_MS);
    }
    if (h.getSession().hand?.activePlayerId === HERO_PLAYER_ID) {
      expect(h.driver.getState().status).toBe('running');
      expect(h.driver.getState().remainingSeconds).toBe(10);
      clock.advance(10_000);
      expect(h.getAutoTimeoutCalls()).toBe(1);
    }
    h.cleanup();
  });

  it('O3: handles both callback orders, hero turn right near reveal, superseded deal, consecutive deals, reset session, reduced motion, and stale callbacks', () => {
    const clock = createFakeClock();

    // 1. Hero turn arrives RIGHT BEFORE reveal completes (botSpeedMs 300ms < 320ms deal animation)
    const base = createSandboxSession({
      seed: 'p5-o3-near-reveal',
      settings: { playerCount: 4, allowOutOfTurn: false, botSpeedMs: 300 },
    });
    const rivalOpener = base.hand!.seats.find((s) => s.playerId !== HERO_PLAYER_ID)!.playerId;
    const sNear = createSandboxSession({
      seed: 'p5-o3-near-reveal',
      settings: { playerCount: 4, allowOutOfTurn: false, botSpeedMs: 300 },
      fixtures: { openerId: rivalOpener },
    });
    const h = createTournamentHarness({ session: sNear, clock });
    expect(h.getDealState()).toBe('animating');

    clock.advance(300);
    while (
      h.getSession().hand?.activePlayerId !== HERO_PLAYER_ID &&
      h.getSession().hand?.phase === 'betting'
    ) {
      h.stepBot('fast bot before reveal');
    }
    if (h.getSession().hand?.activePlayerId === HERO_PLAYER_ID) {
      expect(h.driver.getState().status).toBe('waiting-animation');
      clock.advance(19);
      expect(h.driver.getState().status).toBe('waiting-animation');
      clock.advance(1);
      expect(h.driver.getState().status).toBe('running');
      expect(h.driver.getState().remainingSeconds).toBe(20);
    }
    h.cleanup();

    // 2. Reverse callback order & reducedMotion: onDealAnimationEnd('completed') arrives BEFORE onHeroTurnChange
    const sReduced = createSandboxSession({
      seed: 'p5-o3-reduced',
      settings: { playerCount: 4, allowOutOfTurn: false, reducedMotion: true },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const driverRev = new TournamentClockDriver({
      initialDurationSeconds: 20,
      initialReducedMotion: true,
      now: clock.now,
    });
    let currentSession: SandboxSessionState = sReduced;
    let revTimeouts = 0;
    driverRev.setController({
      getState: () => currentSession,
      autoTimeoutHeroAction: (expectedTurnKey?: string) => {
        revTimeouts += 1;
        currentSession = performHeroAutoTimeout(currentSession, expectedTurnKey);
      },
    });
    driverRev.handleDealAnimationEnd({
      handNumber: 1,
      street: 'flop',
      eventCount: currentSession.hand!.timeline.length,
      sessionSeed: currentSession.sessionSeed,
      dealKey: `${currentSession.sessionSeed}:1:flop:${currentSession.hand!.board.length}`,
      outcome: 'completed',
    });
    driverRev.handleHeroTurnChange();
    expect(driverRev.getState().status).toBe('running');
    expect(driverRev.getState().remainingSeconds).toBe(20);
    clock.advance(20_000);
    expect(revTimeouts).toBe(1);
    driverRev.dispose();

    // 3. Superseded deal + reset session with identical (handNumber=1, street='flop') + stale completion callback
    const s1 = createSandboxSession({
      seed: 'p5-reset-1',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const hReset = createTournamentHarness({ session: s1, clock });
    clock.advance(150);
    hReset.resetSession('p5-reset-2');
    const supersededEv = hReset.getDealEvents().find((e) => e.outcome === 'superseded');
    expect(supersededEv).toBeDefined();
    expect(supersededEv?.sessionSeed).toBe('p5-reset-1');
    expect(supersededEv?.dealKey).toBe('p5-reset-1:1:flop:3');
    expect(supersededEv?.dealGeneration).toBe(1);

    clock.advance(170);
    expect(hReset.driver.getState().status).toBe('waiting-animation');
    hReset.driver.handleDealAnimationEnd({
      handNumber: 1,
      street: 'turn',
      eventCount: 99,
      sessionSeed: 'p5-reset-2',
      dealKey: 'p5-reset-2:1:turn:4',
      outcome: 'completed',
    });
    expect(hReset.driver.getState().status).toBe('waiting-animation');

    clock.advance(150);
    expect(hReset.driver.getState().status).toBe('running');

    hReset.resetSession('p5-reset-3');
    expect(hReset.driver.getState().status).toBe('waiting-animation');
    clock.advance(DEAL_MS - 1);
    expect(hReset.driver.getState().status).toBe('waiting-animation');
    clock.advance(1);
    expect(hReset.driver.getState().status).toBe('running');
    hReset.cleanup();

    // 4. Two consecutive deals (Flop completed -> advance to Turn -> Flop completion never unlocks Turn)
    const sConsec = createSandboxSession({
      seed: 'p5-consec-deals',
      settings: {
        playerCount: 4,
        enabledRivalIds: ['da', 'ca', 'tho'],
        allowOutOfTurn: false,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const hConsec = createTournamentHarness({ session: sConsec, clock });
    clock.advance(DEAL_MS);
    expect(hConsec.driver.getState().status).toBe('running');

    let guard = 0;
    while (
      hConsec.getSession().phase === 'in-hand' &&
      hConsec.getSession().hand!.phase === 'betting' &&
      hConsec.getSession().hand!.street === 'flop' &&
      guard < 20
    ) {
      guard += 1;
      if (hConsec.getSession().hand!.activePlayerId === HERO_PLAYER_ID) {
        const val = getHeroActionValidation(hConsec.getSession());
        if (val.canCheck) {
          hConsec.heroAct('check');
        } else {
          hConsec.heroAct('fold');
        }
      } else {
        hConsec.stepBot('consec bot');
      }
    }
    if (
      hConsec.getSession().hand?.phase === 'betting' &&
      hConsec.getSession().hand?.street === 'turn'
    ) {
      expect(hConsec.getDealState()).toBe('animating');
      if (hConsec.getSession().hand!.activePlayerId === HERO_PLAYER_ID) {
        expect(hConsec.driver.getState().status).toBe('waiting-animation');
      }
      hConsec.driver.handleDealAnimationEnd({
        handNumber: 1,
        street: 'flop',
        eventCount: 3,
        sessionSeed: 'p5-consec-deals',
        dealKey: 'p5-consec-deals:1:flop:3',
        outcome: 'completed',
      });
      if (hConsec.getSession().hand!.activePlayerId === HERO_PLAYER_ID) {
        expect(hConsec.driver.getState().status).toBe('waiting-animation');
      }
      clock.advance(DEAL_MS);
      if (hConsec.getSession().hand!.activePlayerId === HERO_PLAYER_ID) {
        expect(hConsec.driver.getState().status).toBe('running');
      }
    }
    hConsec.cleanup();
  });

  it('O4: supports 10/15/20/25s timers; mid-hand change applies on the NEXT hand only', () => {
    const clock = createFakeClock();
    for (const dur of [10, 15, 20, 25] as const) {
      const sDur = createSandboxSession({
        seed: `p5-o4-dur-${dur}`,
        settings: {
          playerCount: 4,
          allowOutOfTurn: false,
          tournamentTimerSeconds: dur,
          reducedMotion: true,
        },
        fixtures: { openerId: HERO_PLAYER_ID },
      });
      const hDur = createTournamentHarness({ session: sDur, clock });
      expect(hDur.driver.getState().configuredDurationSeconds).toBe(dur);
      expect(hDur.driver.getState().remainingSeconds).toBe(dur);
      clock.advance(dur * 1000 - 1);
      expect(hDur.getAutoTimeoutCalls()).toBe(0);
      clock.advance(1);
      expect(hDur.getAutoTimeoutCalls()).toBe(1);
      hDur.cleanup();
    }

    const session = createSandboxSession({
      seed: 'p5-o4-settings',
      settings: {
        playerCount: 4,
        allowOutOfTurn: false,
        tournamentTimerSeconds: 25,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const h = createTournamentHarness({ session, clock });
    clock.advance(DEAL_MS);
    expect(h.driver.getState().configuredDurationSeconds).toBe(25);
    expect(h.driver.getState().remainingSeconds).toBe(25);

    h.applySettings(
      { ...h.getSession().appliedSettings, tournamentTimerSeconds: 10 },
      'apply-boundary',
    );
    expect(h.getSession().appliedSettings.tournamentTimerSeconds).toBe(25);
    expect(h.getSession().pendingSettings?.tournamentTimerSeconds).toBe(10);
    expect(h.driver.getState().configuredDurationSeconds).toBe(25);
    expect(h.driver.getState().pendingTimerSeconds).toBe(10);

    h.heroAct('fold');
    h.stepBotsUntilHeroOrEnd();
    expect(h.getSession().hand!.phase).toBe('complete');

    h.nextHand();
    expect(h.getSession().handNumber).toBe(2);
    expect(h.getSession().appliedSettings.tournamentTimerSeconds).toBe(10);
    expect(h.driver.getState().configuredDurationSeconds).toBe(10);
    expect(h.driver.getState().pendingTimerSeconds).toBeNull();

    clock.advance(DEAL_MS);
    h.stepBotsUntilHeroOrEnd();
    if (h.getSession().hand?.activePlayerId === HERO_PLAYER_ID) {
      expect(h.driver.getState().status).toBe('running');
      expect(h.driver.getState().remainingSeconds).toBe(10);
      clock.advance(10_000);
      expect(h.getAutoTimeoutCalls()).toBe(1);
    }
    h.cleanup();
  });

  it('O5: last 3 seconds play timer audio only after user gesture, respecting mute and timer volume', () => {
    const clock = createFakeClock();
    const { FakeAudioContext, createdOscillators } = createFakeAudioEnv();
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });

    const audio = new SandboxAudioEngine({
      muted: false,
      music: 0,
      chips: 75,
      cards: 75,
      timer: 80,
    });
    const session = createSandboxSession({
      seed: 'p5-o5-audio-locked',
      settings: {
        playerCount: 4,
        allowOutOfTurn: false,
        tournamentTimerSeconds: 10,
        reducedMotion: true,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const h = createTournamentHarness({ session, clock, audio });
    clock.advance(10_000);
    expect(h.getTickCalls().length).toBe(3);
    expect(createdOscillators.length).toBe(0);
    h.cleanup();

    audio.unlockFromUserGesture();
    const sUnlocked = createSandboxSession({
      seed: 'p5-o5-audio-unlocked',
      settings: {
        playerCount: 4,
        allowOutOfTurn: false,
        tournamentTimerSeconds: 10,
        reducedMotion: true,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const h2 = createTournamentHarness({ session: sUnlocked, clock, audio });
    clock.advance(10_000);
    expect(createdOscillators.length).toBe(3);
    h2.cleanup();

    createdOscillators.length = 0;
    audio.updateSettings({ muted: true, music: 0, chips: 75, cards: 75, timer: 80 });
    const sMuted = createSandboxSession({
      seed: 'p5-o5-audio-muted',
      settings: {
        playerCount: 4,
        allowOutOfTurn: false,
        tournamentTimerSeconds: 10,
        reducedMotion: true,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const h3 = createTournamentHarness({ session: sMuted, clock, audio });
    clock.advance(10_000);
    expect(createdOscillators.length).toBe(0);
    h3.cleanup();

    audio.updateSettings({ muted: false, music: 0, chips: 75, cards: 75, timer: 0 });
    const sZeroVol = createSandboxSession({
      seed: 'p5-o5-audio-zero',
      settings: {
        playerCount: 4,
        allowOutOfTurn: false,
        tournamentTimerSeconds: 10,
        reducedMotion: true,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const h4 = createTournamentHarness({ session: sZeroVol, clock, audio });
    clock.advance(10_000);
    expect(createdOscillators.length).toBe(0);
    h4.cleanup();
    audio.dispose();
  });

  it('X7 (both branches): binding out-of-turn auto-executes without starting clock; cancelled out-of-turn grants full timer after animation', () => {
    const clock = createFakeClock();

    const base = createSandboxSession({
      seed: 'p5-x7-branch1',
      settings: {
        playerCount: 4,
        enabledRivalIds: ['da', 'ca', 'tho'],
        allowOutOfTurn: true,
        tournamentTimerSeconds: 20,
      },
    });
    const rivalOpener = base.hand!.seats.find((s) => s.playerId !== HERO_PLAYER_ID)!.playerId;
    const s1 = createSandboxSession({
      seed: 'p5-x7-branch1',
      settings: {
        playerCount: 4,
        enabledRivalIds: ['da', 'ca', 'tho'],
        allowOutOfTurn: true,
        tournamentTimerSeconds: 20,
      },
      fixtures: { openerId: rivalOpener },
    });
    const h1 = createTournamentHarness({ session: s1, clock });
    clock.advance(DEAL_MS);

    h1.heroStage(10);
    h1.heroStage(10);
    h1.heroDeclareOot('bet');
    expect(h1.driver.getState().hasBindingOutOfTurn).toBe(true);
    expect(h1.driver.getState().status).toBe('idle');

    let guard = 0;
    let sawAutoExec = false;
    while (
      h1.getSession().phase === 'in-hand' &&
      h1.getSession().hand!.phase === 'betting' &&
      guard < 12
    ) {
      guard += 1;
      const beforeLen = h1.getSession().hand!.timeline.length;
      h1.stepBot(`x7-b1 step ${guard}`);
      const newEvents = h1.getSession().hand!.timeline.slice(beforeLen);
      if (
        newEvents.some(
          (ev) =>
            ev.type === 'player-action' &&
            ev.playerId === HERO_PLAYER_ID &&
            ev.fromOutOfTurn === true,
        )
      ) {
        sawAutoExec = true;
        expect(h1.getAutoTimeoutCalls()).toBe(0);
        expect(h1.driver.getState().status).toBe('idle');
        break;
      }
      if (h1.getSession().hand!.activePlayerId === HERO_PLAYER_ID) {
        break;
      }
    }
    expect(sawAutoExec).toBe(true);
    expect(h1.getAutoTimeoutCalls()).toBe(0);
    h1.cleanup();

    const s2Base = createSandboxSession({
      seed: 'p5-x7-branch2',
      settings: {
        playerCount: 4,
        enabledRivalIds: ['dien', 'da', 'ca'],
        allowOutOfTurn: true,
        tournamentTimerSeconds: 20,
      },
    });
    const dienSeat = s2Base.hand!.seats.find((s) => s.playerId === 'dien');
    expect(dienSeat).toBeDefined();
    const s2 = createSandboxSession({
      seed: 'p5-x7-branch2',
      settings: {
        playerCount: 4,
        enabledRivalIds: ['dien', 'da', 'ca'],
        allowOutOfTurn: true,
        tournamentTimerSeconds: 20,
      },
      fixtures: { openerId: 'dien' },
    });
    const h2 = createTournamentHarness({ session: s2, clock });
    clock.advance(DEAL_MS);

    const heroStackBeforeOot = chipValue(
      h2.getSession().hand!.seats.find((s) => s.playerId === HERO_PLAYER_ID)!.stack,
    );
    h2.heroStage(10);
    h2.heroStage(10);
    h2.heroDeclareOot('bet');

    h2.stepBotsUntilHeroOrEnd();
    expect(h2.getSession().hand!.activePlayerId).toBe(HERO_PLAYER_ID);
    expect(h2.getSession().hand!.awaitingDecision?.hadCancelledDeclaration).toBe(true);
    expect(
      chipValue(
        h2.getSession().hand!.seats.find((s) => s.playerId === HERO_PLAYER_ID)!.stack,
      ),
    ).toBe(heroStackBeforeOot);
    expect(
      h2.getSession().hand!.timeline.some(
        (ev) => ev.type === 'out-of-turn-cancelled' && ev.playerId === HERO_PLAYER_ID,
      ),
    ).toBe(true);

    expect(h2.driver.getState().status).toBe('running');
    expect(h2.driver.getState().remainingSeconds).toBe(20);
    expect(h2.driver.getState().activeTurn?.hadCancelledDeclaration).toBe(true);
    clock.advance(19_000);
    expect(h2.getAutoTimeoutCalls()).toBe(0);
    clock.advance(1_000);
    expect(h2.getAutoTimeoutCalls()).toBe(1);
    h2.cleanup();

    // Branch 2b: OOT cancelled before current deal animation completes -> clock waits for animation, then grants FULL duration
    const s2Anim = createSandboxSession({
      seed: 'p5-x7-branch2-anim',
      settings: {
        playerCount: 4,
        enabledRivalIds: ['dien', 'da', 'ca'],
        allowOutOfTurn: true,
        tournamentTimerSeconds: 15,
      },
      fixtures: { openerId: 'dien' },
    });
    const h2Anim = createTournamentHarness({ session: s2Anim, clock });
    // Before 320ms animation completes (t = 100ms), Hero declares OOT and 'dien' bets to cancel it
    clock.advance(100);
    h2Anim.heroStage(10);
    h2Anim.heroStage(10);
    h2Anim.heroDeclareOot('bet');
    h2Anim.stepBotsUntilHeroOrEnd();
    expect(h2Anim.getSession().hand!.activePlayerId).toBe(HERO_PLAYER_ID);
    expect(h2Anim.getSession().hand!.awaitingDecision?.hadCancelledDeclaration).toBe(true);
    // Deal animation still has 220ms left -> clock must NOT start yet
    expect(h2Anim.driver.getState().status).toBe('waiting-animation');
    clock.advance(219);
    expect(h2Anim.driver.getState().status).toBe('waiting-animation');
    clock.advance(1);
    // Now animation completed -> Hero gets full 15s
    expect(h2Anim.driver.getState().status).toBe('running');
    expect(h2Anim.driver.getState().remainingSeconds).toBe(15);
    clock.advance(14_999);
    expect(h2Anim.getAutoTimeoutCalls()).toBe(0);
    clock.advance(1);
    expect(h2Anim.getAutoTimeoutCalls()).toBe(1);
    h2Anim.cleanup();
  });

  it('mode switch cleanup & return: leaving Tournament cleans timer without silent timeout; returning resumes smoothly without stuck clock', () => {
    const clock = createFakeClock();
    const session = createSandboxSession({
      seed: 'p5-lifecycle-switch',
      settings: {
        playerCount: 4,
        allowOutOfTurn: false,
        tournamentTimerSeconds: 20,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const h = createTournamentHarness({ session, clock });

    clock.advance(DEAL_MS);
    clock.advance(8_000);
    expect(h.driver.getState().status).toBe('running');
    expect(h.driver.getState().remainingSeconds).toBe(12);

    h.setActive(false);
    expect(h.driver.getState().status).toBe('paused');
    expect(h.driver.getState().remainingSeconds).toBe(12);
    clock.advance(60_000);
    expect(h.getAutoTimeoutCalls()).toBe(0);
    expect(h.getTickCalls()).toEqual([]);

    h.setActive(true);
    expect(h.driver.getState().status).toBe('running');
    expect(h.driver.getState().remainingSeconds).toBe(12);
    expect(h.getAutoTimeoutCalls()).toBe(0);

    clock.advance(9_000);
    expect(h.driver.getState().remainingSeconds).toBe(3);
    expect(h.getTickCalls()).toEqual([{ urgent: false }]);
    clock.advance(3_000);
    expect(h.getAutoTimeoutCalls()).toBe(1);
    expect(h.getTickCalls()).toEqual([
      { urgent: false },
      { urgent: false },
      { urgent: true },
    ]);

    const sAnim = createSandboxSession({
      seed: 'p5-lifecycle-anim',
      settings: { playerCount: 4, allowOutOfTurn: false, tournamentTimerSeconds: 15 },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const hAnim = createTournamentHarness({ session: sAnim, clock });
    clock.advance(100);
    expect(hAnim.driver.getState().status).toBe('waiting-animation');
    hAnim.setActive(false);
    clock.advance(5_000);
    expect(hAnim.getAutoTimeoutCalls()).toBe(0);
    hAnim.setActive(true);
    if (hAnim.driver.getState().status === 'waiting-animation') {
      clock.advance(DEAL_MS);
    }
    expect(hAnim.driver.getState().status).toBe('running');
    expect(hAnim.driver.getState().remainingSeconds).toBe(15);

    h.cleanup();
    hAnim.cleanup();
  });

  it('D34: Tournament reuses Sandbox boundary rebuy/cash-out with no elimination and preserves INV-1 & INV-2', () => {
    let s = createSandboxSession({
      seed: 'p5-d34-rebuy',
      settings: { playerCount: 4, allowOutOfTurn: false },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    assertAllInvariants(s, 'd34 init');

    s = performHeroAction(s, 'fold');
    while (s.phase === 'in-hand' && s.hand?.phase === 'betting') {
      s = stepOneBotTurn(s);
      assertAllInvariants(s, 'd34 bot');
    }
    s = enterHandBoundary(s);
    assertAllInvariants(s, 'd34 boundary');

    // Simulate Hero at 0 chips (not eliminated!) and verify rebuy 500 + next hand works
    const heroSeat = s.boundary!.seats.find((x) => x.playerId === HERO_PLAYER_ID)!;
    const otherSeat = s.boundary!.seats.find((x) => x.playerId !== HERO_PLAYER_ID)!;
    const zeroHeroSession: SandboxSessionState = {
      ...s,
      boundary: {
        ...s.boundary!,
        seats: s.boundary!.seats.map((seat) => {
          if (seat.playerId === HERO_PLAYER_ID) {
            return { ...seat, stack: emptyChips() };
          }
          if (seat.playerId === otherSeat.playerId) {
            return {
              ...seat,
              stack: {
                5: seat.stack[5] + heroSeat.stack[5],
                10: seat.stack[10] + heroSeat.stack[10],
                50: seat.stack[50] + heroSeat.stack[50],
                100: seat.stack[100] + heroSeat.stack[100],
              },
            };
          }
          return seat;
        }),
      },
    };
    assertAllInvariants(zeroHeroSession, 'd34 zero hero');
    const afterRebuy = rebuyPlayerAtBoundary(zeroHeroSession, HERO_PLAYER_ID);
    assertAllInvariants(afterRebuy, 'd34 after hero rebuy');
    expect(
      chipValue(
        afterRebuy.boundary!.seats.find((x) => x.playerId === HERO_PLAYER_ID)!.stack,
      ),
    ).toBe(500);

    const hand2 = startNextHand(afterRebuy);
    assertAllInvariants(hand2, 'd34 hand 2');
    expect(hand2.phase).toBe('in-hand');
    expect(hand2.hand!.seats.some((x) => x.playerId === HERO_PLAYER_ID)).toBe(true);

    // Also verify computeTurnKey stays constant across chip-exchange events
    const hTest: HandState = hand2.hand!;
    const keyBefore = computeTurnKey(hand2.sessionSeed, hand2.handNumber, hTest);
    expect(keyBefore).toContain(`${hand2.sessionSeed}:${hand2.handNumber}:`);
  });

  it('O3 regression (Control/Terra repro): sb-1-0 hand 1 flop replaced by sb-a-0 hand 1 flop rejects old completion and unidentified signals; same-seed generation reset rejects gen 1', () => {
    const clock = createFakeClock();
    const settings = { playerCount: 4, allowOutOfTurn: false };
    const previous = createSandboxSession({
      seed: 'sb-1-0',
      settings,
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const current = createSandboxSession({
      seed: 'sb-a-0',
      settings,
      fixtures: { openerId: HERO_PLAYER_ID },
    });

    // 1. Direct TournamentClockDriver repro matching deal-reset-repro.cjs
    let liveSession = previous;
    const driver = new TournamentClockDriver({ now: clock.now });
    driver.setController({
      getState: () => liveSession,
      autoTimeoutHeroAction: () => {},
    });
    const oldCompleted = {
      handNumber: previous.handNumber,
      street: previous.hand!.street,
      eventCount: previous.hand!.timeline.length,
      outcome: 'completed' as const,
      sessionSeed: previous.sessionSeed,
      dealKey: `${previous.sessionSeed}:${previous.handNumber}:${previous.hand!.street}:${previous.hand!.board.length}`,
    };

    liveSession = current;
    driver.handleHeroTurnChange();
    expect(driver.getState().status).toBe('waiting-animation');

    // Old completion from sb-1-0 MUST leave sb-a-0 waiting-animation!
    driver.handleDealAnimationEnd(oldCompleted);
    expect(driver.getState().status).toBe('waiting-animation');
    expect(driver.getState().completedDealKey).toBeNull();

    // Unidentified completion lacking sessionSeed/dealKey MUST also be rejected (no stamping with live session)!
    driver.handleDealAnimationEnd({
      handNumber: current.handNumber,
      street: current.hand!.street,
      eventCount: current.hand!.timeline.length,
      outcome: 'completed',
    });
    expect(driver.getState().status).toBe('waiting-animation');
    expect(driver.getState().completedDealKey).toBeNull();

    // Exact new completion for sb-a-0 unlocks clock!
    driver.handleDealAnimationEnd({
      handNumber: current.handNumber,
      street: current.hand!.street,
      eventCount: current.hand!.timeline.length,
      sessionSeed: current.sessionSeed,
      dealKey: `${current.sessionSeed}:${current.handNumber}:${current.hand!.street}:${current.hand!.board.length}`,
      outcome: 'completed',
    });
    expect(driver.getState().status).toBe('running');
    driver.dispose();

    // 2. Full Sandbox lifecycle / Tournament integration seam with identical handNumber & street + same-seed dealGeneration reset
    const h = createTournamentHarness({ session: previous, clock });
    clock.advance(100);
    // Replace sb-1-0 hand 1 flop with sb-a-0 hand 1 flop mid-animation
    h.resetSession('sb-a-0', settings);
    expect(h.driver.getState().status).toBe('waiting-animation');

    const superseded = h.getDealEvents().find((e) => e.outcome === 'superseded');
    expect(superseded).toEqual({
      handNumber: 1,
      street: 'flop',
      eventCount: previous.hand!.timeline.length,
      sessionSeed: 'sb-1-0',
      dealKey: 'sb-1-0:1:flop:3',
      dealGeneration: 1,
      outcome: 'superseded',
    });

    // Inject old sb-1-0 completion -> still waiting-animation
    h.driver.handleDealAnimationEnd(oldCompleted);
    expect(h.driver.getState().status).toBe('waiting-animation');

    // Finish sb-a-0 animation at +320ms -> now running with sb-a-0 identity
    clock.advance(DEAL_MS);
    expect(h.driver.getState().status).toBe('running');
    const latestCompleted = h.getDealEvents().filter((e) => e.outcome === 'completed').pop();
    expect(latestCompleted?.sessionSeed).toBe('sb-a-0');
    expect(latestCompleted?.dealKey).toBe('sb-a-0:1:flop:3');
    expect(latestCompleted?.dealGeneration).toBe(2);

    // Same-seed session reset (sb-a-0 gen 2 -> sb-a-0 gen 3): gen 2 completion must NOT unlock gen 3!
    h.resetSession('sb-a-0', settings);
    expect(h.getDealGeneration()).toBe(3);
    expect(h.driver.getState().status).toBe('waiting-animation');
    h.driver.handleDealAnimationEnd({
      handNumber: 1,
      street: 'flop',
      eventCount: h.getSession().hand!.timeline.length,
      sessionSeed: 'sb-a-0',
      dealKey: 'sb-a-0:1:flop:3',
      dealGeneration: 2,
      outcome: 'completed',
    });
    expect(h.driver.getState().status).toBe('waiting-animation');
    clock.advance(DEAL_MS);
    expect(h.driver.getState().status).toBe('running');
    h.cleanup();
  });

  it('O3/O5 idempotency regression: repeated completed event while paused preserves remainingMs and tick dedup across Activity hide/reveal', () => {
    const clock = createFakeClock();
    const session = createSandboxSession({
      seed: 'p5-paused-idempotent',
      settings: {
        playerCount: 4,
        allowOutOfTurn: false,
        tournamentTimerSeconds: 10,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const h = createTournamentHarness({ session, clock });

    // Deal completes -> advance 7,500ms -> 2,500ms remaining (remainingSeconds = 3), 3s tick already fired once
    clock.advance(DEAL_MS);
    clock.advance(7_500);
    expect(h.driver.getState().status).toBe('running');
    expect(h.driver.getState().remainingSeconds).toBe(3);
    expect(h.getTickCalls()).toEqual([{ urgent: false }]);

    // Activity hides / Tournament becomes inactive -> paused with ~2,500ms remaining
    h.driver.setMounted(false);
    h.setActive(false);
    expect(h.driver.getState().status).toBe('paused');
    expect(h.driver.getState().remainingMs).toBe(2_500);
    expect(h.driver.getState().remainingSeconds).toBe(3);
    expect(h.driver.getState().lastTickedSecond).toBe(3);

    // Repeated completed event while paused MUST NOT rewrite remainingMs back to 10,000ms or clear lastTickedSecond!
    h.driver.handleDealAnimationEnd({
      handNumber: 1,
      street: 'flop',
      eventCount: h.getSession().hand!.timeline.length,
      sessionSeed: h.getSession().sessionSeed,
      dealKey: `${h.getSession().sessionSeed}:1:flop:3`,
      dealGeneration: h.getDealGeneration(),
      outcome: 'completed',
    });
    expect(h.driver.getState().status).toBe('paused');
    expect(h.driver.getState().remainingMs).toBe(2_500);
    expect(h.driver.getState().remainingSeconds).toBe(3);
    expect(h.driver.getState().lastTickedSecond).toBe(3);

    // Simulate Activity reveal ordering: onHeroTurnChange fires BEFORE setMounted(true)/setActive(true),
    // and then again AFTER -> remainder and tick dedup remain intact!
    h.driver.handleHeroTurnChange();
    expect(h.driver.getState().status).toBe('paused');
    expect(h.driver.getState().remainingMs).toBe(2_500);

    h.driver.setMounted(true);
    h.setActive(true);
    h.driver.handleHeroTurnChange();
    expect(h.driver.getState().status).toBe('running');
    expect(h.driver.getState().remainingMs).toBe(2_500);
    expect(h.driver.getState().remainingSeconds).toBe(3);

    // Advancing 500ms -> 2s tick; 1,000ms -> 1s tick; 1,000ms -> timeout (no duplicate 3s tick!)
    clock.advance(2_500);
    expect(h.getAutoTimeoutCalls()).toBe(1);
    expect(h.getTickCalls()).toEqual([
      { urgent: false }, // 3s before pause
      { urgent: false }, // 2s after resume
      { urgent: true },  // 1s after resume
    ]);
    h.cleanup();
  });

  it('atomic timeout guard: stale auto-timeout updater cannot act on a newer turn or newer hand queued before it executes', () => {
    // 1. Same hand, Turn 1 -> Hero checks + Bot bets -> Turn 2 on Hero -> Turn 1 timeout updater must no-op!
    const s0 = createSandboxSession({
      seed: 'p5-atomic-turn-guard',
      settings: {
        playerCount: 4,
        enabledRivalIds: ['dien', 'da', 'ca'],
        allowOutOfTurn: false,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const turn1Key = getHeroTurnIdentity(s0);
    expect(turn1Key).not.toBeNull();

    // Simulate newer transitions executing before Turn 1's timeout updater runs:
    let next = performHeroAction(s0, 'check');
    let guard = 0;
    while (
      next.phase === 'in-hand' &&
      next.hand?.phase === 'betting' &&
      next.hand.activePlayerId !== HERO_PLAYER_ID &&
      guard < 12
    ) {
      guard += 1;
      next = stepOneBotTurn(next);
    }
    expect(next.hand?.activePlayerId).toBe(HERO_PLAYER_ID);
    const turn2Key = getHeroTurnIdentity(next);
    expect(turn2Key).not.toBeNull();
    expect(turn2Key).not.toBe(turn1Key);

    // Stage a chip on Turn 2, then execute stale Turn 1 timeout updater
    const turn2WithChip = stageChip(next, 10);
    const afterStaleTimeout = performHeroAutoTimeout(turn2WithChip, turn1Key!);
    expect(afterStaleTimeout).toBe(turn2WithChip);
    expect(afterStaleTimeout.hand?.activePlayerId).toBe(HERO_PLAYER_ID);
    expect(chipValue(afterStaleTimeout.stagedChips)).toBe(10);
    assertAllInvariants(afterStaleTimeout, 'after rejected stale turn1 timeout');

    // 2. Hand 1 Turn 1 -> Hand 1 finishes -> Hand 2 starts (Hero opens) -> Turn 1 timeout updater must no-op!
    let handDone = performHeroAction(s0, 'fold');
    while (handDone.phase === 'in-hand' && handDone.hand?.phase === 'betting') {
      handDone = stepOneBotTurn(handDone);
    }
    const hand2 = startNextHand(handDone, { openerId: HERO_PLAYER_ID });
    expect(hand2.handNumber).toBe(2);
    expect(hand2.hand?.activePlayerId).toBe(HERO_PLAYER_ID);

    const afterStaleHand1Timeout = performHeroAutoTimeout(hand2, turn1Key!);
    expect(afterStaleHand1Timeout).toBe(hand2);
    expect(afterStaleHand1Timeout.handNumber).toBe(2);
    expect(afterStaleHand1Timeout.hand?.activePlayerId).toBe(HERO_PLAYER_ID);
    assertAllInvariants(afterStaleHand1Timeout, 'after rejected stale hand1 timeout on hand2');
  });

  it('Terra generation-aware turn identity regression: Gen 1 timeout + identical seed reset to Gen 2 starts full clock in both completion orderings and blocks late Gen 1 callbacks/ticks', () => {
    const clock = createFakeClock();
    const timerCallbacks: Array<{ cb: () => void; ms: number }> = [];

    // Variant A: onHeroTurnChange -> onDealAnimationEnd('completed') on Gen 2 after Gen 1 timed out
    const sGen1 = createSandboxSession({
      seed: 'same',
      settings: {
        playerCount: 4,
        allowOutOfTurn: false,
        tournamentTimerSeconds: 10,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    const h = createTournamentHarness({ session: sGen1, clock });

    // Gen 1 completes deal and times out at 10s
    clock.advance(DEAL_MS);
    expect(h.driver.getState().status).toBe('running');
    const gen1TurnKey = h.driver.getState().activeTurn?.turnKey;
    expect(gen1TurnKey).toBe('same:1:flop:2:g1');
    clock.advance(10_000);
    expect(h.getAutoTimeoutCalls()).toBe(1);
    expect(h.driver.getState().timedOutTurnKey).toBe('same:1:flop:2:g1');
    expect(h.getTickCalls().length).toBe(3);

    // Reset to Gen 2 with the IDENTICAL seed 'same', hand 1, flop, step 2
    h.resetSession('same', {
      playerCount: 4,
      allowOutOfTurn: false,
      tournamentTimerSeconds: 10,
    });
    expect(h.getDealGeneration()).toBe(2);
    expect(h.driver.getState().status).toBe('waiting-animation');
    expect(h.driver.getState().activeTurn?.turnKey).toBe('same:1:flop:2:g2');

    // Re-running handleHeroTurnChange while waiting must NOT revert to timed-out
    h.driver.handleHeroTurnChange();
    expect(h.driver.getState().status).toBe('waiting-animation');

    // Gen 2 deal completes -> must enter 'running' with full 10s (NOT stuck waiting-animation or timed-out!)
    clock.advance(DEAL_MS);
    expect(h.driver.getState().status).toBe('running');
    expect(h.driver.getState().remainingSeconds).toBe(10);

    // Late Gen 1 action guard: passing Gen 1 turnKey to performHeroAutoTimeout during Gen 2 must no-op
    const gen2BeforeLate = h.getSession();
    const afterLateGen1Guard = performHeroAutoTimeout(
      gen2BeforeLate,
      gen1TurnKey,
      h.getDealGeneration(),
    );
    expect(afterLateGen1Guard).toBe(gen2BeforeLate);
    expect(h.driver.getState().status).toBe('running');

    // Gen 2 completes its own full 10s countdown and times out cleanly
    clock.advance(10_000);
    expect(h.getAutoTimeoutCalls()).toBe(2);
    expect(h.driver.getState().timedOutTurnKey).toBe('same:1:flop:2:g2');
    h.cleanup();

    // Variant B: Reverse completion ordering (onDealAnimationEnd BEFORE onHeroTurnChange) + stale timer wakeup guard
    let currentGen = 1;
    let sessionRev = createSandboxSession({
      seed: 'same',
      settings: { playerCount: 4, allowOutOfTurn: false, tournamentTimerSeconds: 10 },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    let revTimeoutCalls = 0;
    let revTickCalls = 0;

    const driverRev = new TournamentClockDriver({
      initialDurationSeconds: 10,
      now: clock.now,
      setTimeoutFn: (cb, ms) => {
        timerCallbacks.push({ cb, ms });
        return timerCallbacks.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    });

    driverRev.setController({
      getState: () => sessionRev,
      getDealGeneration: () => currentGen,
      autoTimeoutHeroAction: (expectedTurnKey?: string) => {
        revTimeoutCalls += 1;
        sessionRev = performHeroAutoTimeout(sessionRev, expectedTurnKey, currentGen);
      },
      playTimerTick: () => {
        revTickCalls += 1;
      },
    });

    // Complete Gen 1 deal and run up to 7s (so a timer callback for Gen 1 is captured at 8s)
    driverRev.handleDealAnimationEnd({
      handNumber: 1,
      street: 'flop',
      eventCount: sessionRev.hand!.timeline.length,
      sessionSeed: 'same',
      dealKey: 'same:1:flop:3',
      dealGeneration: 1,
      outcome: 'completed',
    });
    expect(driverRev.getState().status).toBe('running');
    const staleGen1TimerCb = timerCallbacks[timerCallbacks.length - 1]!.cb;

    // Now simulate Gen 1 timing out directly and resetting to Gen 2 with reverse callback order
    for (let sec = 0; sec < 10; sec++) {
      clock.advance(1000);
      timerCallbacks[timerCallbacks.length - 1]!.cb();
    }
    expect(revTimeoutCalls).toBe(1);
    expect(driverRev.getState().timedOutTurnKey).toBe('same:1:flop:2:g1');
    const ticksBeforeGen2 = revTickCalls;

    // Reset to Gen 2 with identical seed 'same'
    currentGen = 2;
    sessionRev = createSandboxSession({
      seed: 'same',
      settings: { playerCount: 4, allowOutOfTurn: false, tournamentTimerSeconds: 10 },
      fixtures: { openerId: HERO_PLAYER_ID },
    });
    // Reverse order: Gen 2 deal completion arrives BEFORE handleHeroTurnChange
    driverRev.handleDealAnimationEnd({
      handNumber: 1,
      street: 'flop',
      eventCount: sessionRev.hand!.timeline.length,
      sessionSeed: 'same',
      dealKey: 'same:1:flop:3',
      dealGeneration: 2,
      outcome: 'completed',
    });
    driverRev.handleHeroTurnChange();
    expect(driverRev.getState().status).toBe('running');
    expect(driverRev.getState().remainingSeconds).toBe(10);
    expect(driverRev.getState().activeTurn?.turnKey).toBe('same:1:flop:2:g2');

    // Invoking the stale Gen 1 timer callback while Gen 2 is running MUST NOT act or emit a tick!
    staleGen1TimerCb();
    expect(revTickCalls).toBe(ticksBeforeGen2);
    expect(revTimeoutCalls).toBe(1);
    expect(driverRev.getState().status).toBe('running');
    driverRev.dispose();
  });

  it('Neon O4 settings-only sync regression: syncs pendingTimerSeconds and effectiveReducedMotion immediately without interrupting active deadline, and handles cancellation', () => {
    const clock = createFakeClock();
    const session = createSandboxSession({
      seed: 'p5-o4-settings-sync',
      settings: {
        playerCount: 4,
        allowOutOfTurn: false,
        tournamentTimerSeconds: 20,
        reducedMotion: false,
      },
      fixtures: { openerId: HERO_PLAYER_ID },
    });

    // Track state updates emitted by TournamentClockDriver
    let liveSession = session;
    let effectiveRm = false;
    let timerRescheduleCount = 0;
    const states: Array<{
      pendingTimerSeconds: number | null;
      configuredDurationSeconds: number;
      reducedMotion: boolean;
      deadlineMs: number | null;
      status: string;
    }> = [];

    const driver = new TournamentClockDriver({
      initialDurationSeconds: 20,
      initialReducedMotion: false,
      now: clock.now,
      setTimeoutFn: (cb, ms) => {
        timerRescheduleCount += 1;
        return globalThis.setTimeout(cb, ms);
      },
      onStateChange: (s) => {
        states.push({
          pendingTimerSeconds: s.pendingTimerSeconds,
          configuredDurationSeconds: s.configuredDurationSeconds,
          reducedMotion: s.reducedMotion,
          deadlineMs: s.deadlineMs,
          status: s.status,
        });
      },
    });

    driver.setController({
      getState: () => liveSession,
      getDealGeneration: () => 1,
      isEffectiveReducedMotion: () => effectiveRm,
      autoTimeoutHeroAction: (expectedTurnKey?: string) => {
        liveSession = performHeroAutoTimeout(liveSession, expectedTurnKey, 1);
      },
    });
    driver.handleDealAnimationEnd({
      handNumber: 1,
      street: 'flop',
      eventCount: liveSession.hand!.timeline.length,
      sessionSeed: liveSession.sessionSeed,
      dealKey: `${liveSession.sessionSeed}:1:flop:3`,
      dealGeneration: 1,
      outcome: 'completed',
    });

    expect(driver.getState().status).toBe('running');
    const originalDeadline = driver.getState().deadlineMs;
    expect(originalDeadline).toBe(20_000);

    // Advance 4s -> 16s remaining
    clock.advance(4_000);
    expect(driver.getState().remainingSeconds).toBe(16);
    const reschedulesBeforeSettingsEdit = timerRescheduleCount;

    // Mid-hand settings-only update (same hand object, same turn identity):
    // Change timer 20 -> 10 (queued in pendingSettings) AND toggle reducedMotion -> true
    liveSession = applySettingsUpdate(
      liveSession,
      {
        ...liveSession.appliedSettings,
        tournamentTimerSeconds: 10,
        reducedMotion: true,
      },
      'apply-boundary',
    );
    effectiveRm = true;
    driver.handleHeroTurnChange();

    // Immediately reflects pendingTimerSeconds = 10 & reducedMotion = true while keeping current 20s deadline untouched!
    expect(driver.getState().pendingTimerSeconds).toBe(10);
    expect(driver.getState().configuredDurationSeconds).toBe(20);
    expect(driver.getState().reducedMotion).toBe(true);
    expect(driver.getState().deadlineMs).toBe(originalDeadline);
    expect(driver.getState().status).toBe('running');
    // Must NOT restart/churn the running timer on metadata-only update
    expect(timerRescheduleCount).toBe(reschedulesBeforeSettingsEdit);

    // Cancel pending timer setting by changing back 10 -> 20 mid-hand: pendingSettings clears to null immediately!
    liveSession = applySettingsUpdate(
      liveSession,
      {
        ...liveSession.appliedSettings,
        tournamentTimerSeconds: 20,
        reducedMotion: true,
      },
      'apply-boundary',
    );
    driver.handleHeroTurnChange();
    expect(driver.getState().pendingTimerSeconds).toBeNull();
    expect(driver.getState().configuredDurationSeconds).toBe(20);
    expect(driver.getState().deadlineMs).toBe(originalDeadline);
    expect(timerRescheduleCount).toBe(reschedulesBeforeSettingsEdit);

    // Non-timer rule change (preflop ON) keeps pendingTimerSeconds === null
    liveSession = applySettingsUpdate(
      liveSession,
      {
        ...liveSession.appliedSettings,
        enablePreflopBetting: true,
      },
      'apply-boundary',
    );
    driver.handleHeroTurnChange();
    expect(driver.getState().pendingTimerSeconds).toBeNull();
    expect(driver.getState().deadlineMs).toBe(originalDeadline);

    // Re-queue 15s, confirm remaining 16s still expires at the original 20_000ms mark, then hand #2 uses 15s
    liveSession = applySettingsUpdate(
      liveSession,
      {
        ...liveSession.appliedSettings,
        tournamentTimerSeconds: 15,
      },
      'apply-boundary',
    );
    driver.handleHeroTurnChange();
    expect(driver.getState().pendingTimerSeconds).toBe(15);

    clock.advance(16_000);
    expect(driver.getState().status).toBe('timed-out');
    expect(states[states.length - 1]?.pendingTimerSeconds).toBe(15);

    let finishGuard = 0;
    while (
      liveSession.phase === 'in-hand' &&
      liveSession.hand?.phase === 'betting' &&
      finishGuard < 60
    ) {
      finishGuard += 1;
      if (liveSession.hand.activePlayerId === HERO_PLAYER_ID) {
        liveSession = performHeroAction(liveSession, 'fold');
      } else {
        liveSession = stepOneBotTurn(liveSession);
      }
    }
    liveSession = startNextHand(liveSession, { openerId: HERO_PLAYER_ID });
    driver.handleHeroTurnChange();
    expect(driver.getState().configuredDurationSeconds).toBe(15);
    expect(driver.getState().pendingTimerSeconds).toBeNull();
    driver.dispose();
  });
});
