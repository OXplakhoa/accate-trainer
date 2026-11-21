import {
  getLegalActions,
  type HandState,
  type HandTimelineEvent,
  type Street,
} from '../../engine';
import {
  HERO_PLAYER_ID,
  type DealAnimationEndInfo,
  type SandboxExternalApi,
  type SandboxSessionState,
  type TournamentTimerSeconds,
} from '../sandbox';
import type { TournamentClockState, TournamentTurnDescriptor } from './types';

export function computeDealKey(sessionSeed: string, handNumber: number, street: Street): string {
  return `${sessionSeed}:${handNumber}:${street}`;
}

/**
 * Counts timeline events that actually advance turns/deals, intentionally excluding
 * `chip-exchange` so mid-turn chip exchanges never reset Hero's Tournament shot clock.
 */
export function computeNonExchangeStepCount(timeline: readonly HandTimelineEvent[]): number {
  let count = 0;
  for (const ev of timeline) {
    if (
      ev.type === 'cards-dealt' ||
      ev.type === 'street-dealt' ||
      ev.type === 'player-action'
    ) {
      count++;
    }
  }
  return count;
}

export function computeTurnKey(
  sessionSeed: string,
  handNumber: number,
  hand: HandState,
): string {
  return `${sessionSeed}:${handNumber}:${hand.street}:${computeNonExchangeStepCount(hand.timeline)}`;
}

export function isFreeHeroDecisionTurn(session: SandboxSessionState | null): boolean {
  if (session === null || session.phase !== 'in-hand' || session.hand === null) {
    return false;
  }
  const hand = session.hand;
  if (hand.phase !== 'betting' || hand.activePlayerId !== HERO_PLAYER_ID) {
    return false;
  }
  if (session.pendingHeroLeave) {
    return false;
  }
  return getLegalActions(hand) !== null;
}

export function hasBindingHeroOutOfTurnDeclaration(session: SandboxSessionState | null): boolean {
  if (session === null || session.phase !== 'in-hand' || session.hand === null) {
    return false;
  }
  if (session.hand.phase !== 'betting') {
    return false;
  }
  const heroSeat = session.hand.seats.find((s) => s.playerId === HERO_PLAYER_ID);
  return heroSeat !== undefined && heroSeat.declaration !== null;
}

export function createInitialTournamentClockState(
  configuredDurationSeconds: TournamentTimerSeconds = 20,
  reducedMotion = false,
): TournamentClockState {
  return {
    status: 'idle',
    activeTurn: null,
    completedDealKey: null,
    deadlineMs: null,
    remainingMs: configuredDurationSeconds * 1000,
    remainingSeconds: configuredDurationSeconds,
    configuredDurationSeconds,
    pendingTimerSeconds: null,
    hasBindingOutOfTurn: false,
    lastTickedSecond: null,
    timedOutTurnKey: null,
    reducedMotion,
  };
}

function readPendingTimerSeconds(
  session: SandboxSessionState | null,
  appliedSeconds: TournamentTimerSeconds,
): TournamentTimerSeconds | null {
  const pending = session?.pendingSettings?.tournamentTimerSeconds;
  if (pending === undefined || pending === appliedSeconds) {
    return null;
  }
  return pending;
}

export function pauseTournamentClock(
  state: TournamentClockState,
  nowMs: number,
): TournamentClockState {
  if (state.status !== 'running' || state.activeTurn === null) {
    return state;
  }
  const rawRemaining =
    state.deadlineMs !== null ? Math.max(0, state.deadlineMs - nowMs) : state.remainingMs;
  const remainingMs = rawRemaining > 0 ? rawRemaining : 1;
  return {
    ...state,
    status: 'paused',
    deadlineMs: null,
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
}

export function reconcileSessionSnapshot(
  state: TournamentClockState,
  session: SandboxSessionState | null,
  active: boolean,
  nowMs: number,
): TournamentClockState {
  const configuredDurationSeconds =
    session?.appliedSettings.tournamentTimerSeconds ?? state.configuredDurationSeconds;
  const pendingTimerSeconds = readPendingTimerSeconds(session, configuredDurationSeconds);
  const hasBindingOutOfTurn = hasBindingHeroOutOfTurnDeclaration(session);
  const reducedMotion = session?.appliedSettings.reducedMotion ?? state.reducedMotion;

  const currentBettingDealKey =
    session !== null &&
    session.phase === 'in-hand' &&
    session.hand !== null &&
    session.hand.phase === 'betting'
      ? computeDealKey(session.sessionSeed, session.handNumber, session.hand.street)
      : null;

  const validCompletedDealKey =
    currentBettingDealKey !== null && state.completedDealKey === currentBettingDealKey
      ? state.completedDealKey
      : null;

  if (!isFreeHeroDecisionTurn(session) || session === null || session.hand === null) {
    return {
      ...state,
      status: 'idle',
      activeTurn: null,
      completedDealKey: validCompletedDealKey,
      deadlineMs: null,
      remainingMs: configuredDurationSeconds * 1000,
      remainingSeconds: configuredDurationSeconds,
      configuredDurationSeconds,
      pendingTimerSeconds,
      hasBindingOutOfTurn,
      lastTickedSecond: null,
      reducedMotion,
    };
  }

  const hand = session.hand;
  const nextDealKey = computeDealKey(session.sessionSeed, session.handNumber, hand.street);
  const nextTurnKey = computeTurnKey(session.sessionSeed, session.handNumber, hand);
  const isDealCompleted = validCompletedDealKey === nextDealKey;
  const hadCancelledDeclaration = hand.awaitingDecision?.hadCancelledDeclaration ?? false;

  if (state.activeTurn !== null && state.activeTurn.turnKey === nextTurnKey) {
    if (state.timedOutTurnKey === nextTurnKey) {
      return {
        ...state,
        status: 'timed-out',
        completedDealKey: validCompletedDealKey,
        deadlineMs: null,
        remainingMs: 0,
        remainingSeconds: 0,
        configuredDurationSeconds,
        pendingTimerSeconds,
        hasBindingOutOfTurn,
        reducedMotion,
      };
    }

    if (!active) {
      if (state.status === 'running') {
        const paused = pauseTournamentClock(state, nowMs);
        return {
          ...paused,
          completedDealKey: validCompletedDealKey,
          configuredDurationSeconds,
          pendingTimerSeconds,
          hasBindingOutOfTurn,
          reducedMotion,
        };
      }
      return {
        ...state,
        status: isDealCompleted ? 'paused' : 'waiting-animation',
        completedDealKey: validCompletedDealKey,
        deadlineMs: null,
        configuredDurationSeconds,
        pendingTimerSeconds,
        hasBindingOutOfTurn,
        reducedMotion,
      };
    }

    if (state.status === 'paused' && isDealCompleted) {
      const remainingMs = state.remainingMs > 0 ? state.remainingMs : 1;
      return {
        ...state,
        status: 'running',
        completedDealKey: validCompletedDealKey,
        deadlineMs: nowMs + remainingMs,
        remainingMs,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        configuredDurationSeconds,
        pendingTimerSeconds,
        hasBindingOutOfTurn,
        reducedMotion,
      };
    }

    if (state.status === 'waiting-animation' && isDealCompleted) {
      const totalMs = state.activeTurn.durationSeconds * 1000;
      return {
        ...state,
        status: 'running',
        completedDealKey: validCompletedDealKey,
        deadlineMs: nowMs + totalMs,
        remainingMs: totalMs,
        remainingSeconds: state.activeTurn.durationSeconds,
        configuredDurationSeconds,
        pendingTimerSeconds,
        hasBindingOutOfTurn,
        lastTickedSecond: null,
        reducedMotion,
      };
    }

    return {
      ...state,
      completedDealKey: validCompletedDealKey,
      configuredDurationSeconds,
      pendingTimerSeconds,
      hasBindingOutOfTurn,
      reducedMotion,
    };
  }

  // Brand new Hero free decision turn
  const totalMs = configuredDurationSeconds * 1000;
  const nextTurn: TournamentTurnDescriptor = {
    turnKey: nextTurnKey,
    dealKey: nextDealKey,
    sessionSeed: session.sessionSeed,
    handNumber: session.handNumber,
    street: hand.street,
    durationSeconds: configuredDurationSeconds,
    hadCancelledDeclaration,
  };

  if (!active) {
    return {
      ...state,
      status: isDealCompleted ? 'paused' : 'waiting-animation',
      activeTurn: nextTurn,
      completedDealKey: validCompletedDealKey,
      deadlineMs: null,
      remainingMs: totalMs,
      remainingSeconds: configuredDurationSeconds,
      configuredDurationSeconds,
      pendingTimerSeconds,
      hasBindingOutOfTurn,
      lastTickedSecond: null,
      reducedMotion,
    };
  }

  if (isDealCompleted) {
    return {
      ...state,
      status: 'running',
      activeTurn: nextTurn,
      completedDealKey: validCompletedDealKey,
      deadlineMs: nowMs + totalMs,
      remainingMs: totalMs,
      remainingSeconds: configuredDurationSeconds,
      configuredDurationSeconds,
      pendingTimerSeconds,
      hasBindingOutOfTurn,
      lastTickedSecond: null,
      reducedMotion,
    };
  }

  return {
    ...state,
    status: 'waiting-animation',
    activeTurn: nextTurn,
    completedDealKey: validCompletedDealKey,
    deadlineMs: null,
    remainingMs: totalMs,
    remainingSeconds: configuredDurationSeconds,
    configuredDurationSeconds,
    pendingTimerSeconds,
    hasBindingOutOfTurn,
    lastTickedSecond: null,
    reducedMotion,
  };
}

export function applyDealAnimationEnd(
  state: TournamentClockState,
  info: DealAnimationEndInfo,
  session: SandboxSessionState | null,
  active: boolean,
  nowMs: number,
): TournamentClockState {
  if (info.outcome === 'superseded') {
    const dealSuffix = `:${info.handNumber}:${info.street}`;
    const clearedCompleted =
      state.completedDealKey !== null && state.completedDealKey.endsWith(dealSuffix)
        ? null
        : state.completedDealKey;

    const currentMatchesActiveTurn =
      state.activeTurn !== null &&
      session !== null &&
      session.phase === 'in-hand' &&
      session.hand !== null &&
      session.hand.phase === 'betting' &&
      state.activeTurn.sessionSeed === session.sessionSeed &&
      state.activeTurn.handNumber === session.handNumber &&
      state.activeTurn.street === session.hand.street;

    if (
      state.activeTurn !== null &&
      state.activeTurn.handNumber === info.handNumber &&
      state.activeTurn.street === info.street &&
      !currentMatchesActiveTurn
    ) {
      return {
        ...state,
        status: 'idle',
        activeTurn: null,
        completedDealKey: clearedCompleted,
        deadlineMs: null,
        remainingMs: state.configuredDurationSeconds * 1000,
        remainingSeconds: state.configuredDurationSeconds,
        lastTickedSecond: null,
      };
    }

    if (
      state.activeTurn !== null &&
      state.activeTurn.handNumber === info.handNumber &&
      state.activeTurn.street === info.street &&
      state.status === 'running'
    ) {
      return {
        ...state,
        status: 'waiting-animation',
        completedDealKey: clearedCompleted,
        deadlineMs: null,
        remainingMs: state.activeTurn.durationSeconds * 1000,
        remainingSeconds: state.activeTurn.durationSeconds,
        lastTickedSecond: null,
      };
    }

    return clearedCompleted !== state.completedDealKey
      ? { ...state, completedDealKey: clearedCompleted }
      : state;
  }

  // outcome === 'completed'
  if (
    session === null ||
    session.phase !== 'in-hand' ||
    session.hand === null ||
    session.hand.phase !== 'betting' ||
    session.handNumber !== info.handNumber ||
    session.hand.street !== info.street
  ) {
    // Reject stale completion callback after hand/street/session moved on.
    return state;
  }

  const completedKey = computeDealKey(session.sessionSeed, info.handNumber, info.street);
  const nextState: TournamentClockState = {
    ...state,
    completedDealKey: completedKey,
  };

  if (
    nextState.activeTurn !== null &&
    nextState.activeTurn.dealKey === completedKey &&
    nextState.timedOutTurnKey !== nextState.activeTurn.turnKey
  ) {
    if (!active) {
      const totalMs = nextState.activeTurn.durationSeconds * 1000;
      return {
        ...nextState,
        status: 'paused',
        deadlineMs: null,
        remainingMs: totalMs,
        remainingSeconds: nextState.activeTurn.durationSeconds,
      };
    }

    if (nextState.status === 'waiting-animation') {
      const totalMs = nextState.activeTurn.durationSeconds * 1000;
      return {
        ...nextState,
        status: 'running',
        deadlineMs: nowMs + totalMs,
        remainingMs: totalMs,
        remainingSeconds: nextState.activeTurn.durationSeconds,
        lastTickedSecond: null,
      };
    }
  }

  return nextState;
}

export interface ClockAdvanceResult {
  readonly nextState: TournamentClockState;
  readonly playTickUrgent: boolean | null;
  readonly timeoutTurnKey: string | null;
}

export function advanceTournamentClock(
  state: TournamentClockState,
  nowMs: number,
): ClockAdvanceResult {
  if (state.status !== 'running' || state.activeTurn === null || state.deadlineMs === null) {
    return {
      nextState: state,
      playTickUrgent: null,
      timeoutTurnKey: null,
    };
  }

  const remainingMs = Math.max(0, state.deadlineMs - nowMs);
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  if (remainingMs <= 0) {
    if (state.timedOutTurnKey === state.activeTurn.turnKey) {
      return {
        nextState: {
          ...state,
          status: 'timed-out',
          deadlineMs: null,
          remainingMs: 0,
          remainingSeconds: 0,
        },
        playTickUrgent: null,
        timeoutTurnKey: null,
      };
    }
    return {
      nextState: {
        ...state,
        status: 'timed-out',
        deadlineMs: null,
        remainingMs: 0,
        remainingSeconds: 0,
        timedOutTurnKey: state.activeTurn.turnKey,
      },
      playTickUrgent: null,
      timeoutTurnKey: state.activeTurn.turnKey,
    };
  }

  const shouldTick =
    remainingSeconds >= 1 &&
    remainingSeconds <= 3 &&
    state.lastTickedSecond !== remainingSeconds;

  return {
    nextState: {
      ...state,
      remainingMs,
      remainingSeconds,
      lastTickedSecond: shouldTick ? remainingSeconds : state.lastTickedSecond,
    },
    playTickUrgent: shouldTick ? remainingSeconds === 1 : null,
    timeoutTurnKey: null,
  };
}

export function nextTimeoutDelayMs(state: TournamentClockState, nowMs: number): number | null {
  if (state.status !== 'running' || state.deadlineMs === null) {
    return null;
  }
  const rem = Math.max(0, state.deadlineMs - nowMs);
  if (rem === 0) {
    return 0;
  }
  const mod = rem % 1000;
  return mod === 0 ? Math.min(1000, rem) : mod;
}

export interface TournamentClockDriverDeps {
  readonly initialDurationSeconds?: TournamentTimerSeconds;
  readonly initialReducedMotion?: boolean;
  readonly initialActive?: boolean;
  readonly now?: () => number;
  readonly setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
  readonly onStateChange?: (state: TournamentClockState) => void;
}

/**
 * Runtime coordinator binding `SandboxExternalApi` + `onDealAnimationEnd` + `onHeroTurnChange`
 * into a single deterministic shot-clock timer with pause/resume on mode switch.
 */
export class TournamentClockDriver {
  private state: TournamentClockState;
  private active: boolean;
  private mounted = true;
  private controller: SandboxExternalApi | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  private readonly now: () => number;
  private readonly setTimeoutFn: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (id: ReturnType<typeof setTimeout>) => void;
  private readonly onStateChange?: (state: TournamentClockState) => void;

  constructor(deps?: TournamentClockDriverDeps) {
    this.state = createInitialTournamentClockState(
      deps?.initialDurationSeconds ?? 20,
      deps?.initialReducedMotion ?? false,
    );
    this.active = deps?.initialActive ?? true;
    this.now = deps?.now ?? (() => Date.now());
    this.setTimeoutFn = deps?.setTimeoutFn ?? ((cb, ms) => globalThis.setTimeout(cb, ms));
    this.clearTimeoutFn = deps?.clearTimeoutFn ?? ((id) => globalThis.clearTimeout(id));
    this.onStateChange = deps?.onStateChange;
  }

  public getState(): TournamentClockState {
    return this.state;
  }

  public isActive(): boolean {
    return this.active && this.mounted;
  }

  private getEffectiveActive(): boolean {
    return this.active && this.mounted;
  }

  private clearScheduledTimer(): void {
    if (this.timerId !== null) {
      this.clearTimeoutFn(this.timerId);
      this.timerId = null;
    }
  }

  private commitState(next: TournamentClockState): void {
    const changed = next !== this.state;
    this.state = next;
    this.syncTimer();
    if (changed) {
      this.onStateChange?.(next);
    }
  }

  private syncTimer(): void {
    this.clearScheduledTimer();
    if (!this.getEffectiveActive()) {
      return;
    }
    const delay = nextTimeoutDelayMs(this.state, this.now());
    if (delay === null) {
      return;
    }
    this.timerId = this.setTimeoutFn(() => {
      this.timerId = null;
      this.handleTimerWakeup();
    }, delay);
  }

  private handleTimerWakeup(): void {
    if (!this.getEffectiveActive()) {
      return;
    }
    const nowMs = this.now();
    const result = advanceTournamentClock(this.state, nowMs);
    this.commitState(result.nextState);

    if (result.playTickUrgent !== null) {
      this.controller?.playTimerTick?.(result.playTickUrgent);
    }

    if (result.timeoutTurnKey !== null) {
      const session = this.controller?.getState() ?? null;
      if (
        session !== null &&
        isFreeHeroDecisionTurn(session) &&
        session.hand !== null &&
        computeTurnKey(session.sessionSeed, session.handNumber, session.hand) ===
          result.timeoutTurnKey
      ) {
        this.controller?.autoTimeoutHeroAction();
      }
    }
  }

  public setController(api: SandboxExternalApi | null): void {
    this.controller = api;
    const session = api?.getState() ?? null;
    const next = reconcileSessionSnapshot(
      this.state,
      session,
      this.getEffectiveActive(),
      this.now(),
    );
    this.commitState(next);
  }

  public handleHeroTurnChange(): void {
    const session = this.controller?.getState() ?? null;
    const next = reconcileSessionSnapshot(
      this.state,
      session,
      this.getEffectiveActive(),
      this.now(),
    );
    this.commitState(next);
  }

  public handleDealAnimationEnd(info: DealAnimationEndInfo): void {
    const session = this.controller?.getState() ?? null;
    const next = applyDealAnimationEnd(
      this.state,
      info,
      session,
      this.getEffectiveActive(),
      this.now(),
    );
    this.commitState(next);
  }

  public setActive(nextActive: boolean): void {
    if (this.active === nextActive) {
      return;
    }
    this.active = nextActive;
    this.reconcileActivity();
  }

  public setMounted(nextMounted: boolean): void {
    if (this.mounted === nextMounted) {
      return;
    }
    this.mounted = nextMounted;
    this.reconcileActivity();
  }

  private reconcileActivity(): void {
    if (!this.getEffectiveActive()) {
      this.clearScheduledTimer();
      const paused = pauseTournamentClock(this.state, this.now());
      this.commitState(paused);
      return;
    }
    const session = this.controller?.getState() ?? null;
    const resumed = reconcileSessionSnapshot(this.state, session, true, this.now());
    this.commitState(resumed);
  }

  public dispose(): void {
    this.mounted = false;
    this.clearScheduledTimer();
    this.state = pauseTournamentClock(this.state, this.now());
  }
}
