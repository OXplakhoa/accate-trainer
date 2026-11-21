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

export function computeDealKey(
  sessionSeed: string,
  handNumber: number,
  street: Street,
  boardLength: number,
): string {
  return `${sessionSeed}:${handNumber}:${street}:${boardLength}`;
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
  dealGeneration?: number,
): string {
  const base = `${sessionSeed}:${handNumber}:${hand.street}:${computeNonExchangeStepCount(hand.timeline)}`;
  return dealGeneration !== undefined ? `${base}:g${dealGeneration}` : base;
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
    completedDealGeneration: null,
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
  liveDealGeneration?: number,
  effectiveReducedMotionOverride?: boolean,
): TournamentClockState {
  const configuredDurationSeconds =
    session?.appliedSettings.tournamentTimerSeconds ?? state.configuredDurationSeconds;
  const pendingTimerSeconds = readPendingTimerSeconds(session, configuredDurationSeconds);
  const hasBindingOutOfTurn = hasBindingHeroOutOfTurnDeclaration(session);
  const reducedMotion =
    effectiveReducedMotionOverride ??
    session?.appliedSettings.reducedMotion ??
    state.reducedMotion;

  const currentBettingDealKey =
    session !== null &&
    session.phase === 'in-hand' &&
    session.hand !== null &&
    session.hand.phase === 'betting'
      ? computeDealKey(
          session.sessionSeed,
          session.handNumber,
          session.hand.street,
          session.hand.board.length,
        )
      : null;

  const generationMatchesCompleted =
    liveDealGeneration === undefined ||
    state.completedDealGeneration === null ||
    state.completedDealGeneration === liveDealGeneration;

  const validCompletedDealKey =
    currentBettingDealKey !== null &&
    state.completedDealKey === currentBettingDealKey &&
    generationMatchesCompleted
      ? state.completedDealKey
      : null;

  const validCompletedDealGeneration =
    validCompletedDealKey !== null ? state.completedDealGeneration : null;

  if (!isFreeHeroDecisionTurn(session) || session === null || session.hand === null) {
    return {
      ...state,
      status: 'idle',
      activeTurn: null,
      completedDealKey: validCompletedDealKey,
      completedDealGeneration: validCompletedDealGeneration,
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
  const nextDealKey = computeDealKey(
    session.sessionSeed,
    session.handNumber,
    hand.street,
    hand.board.length,
  );
  const nextTurnKey = computeTurnKey(
    session.sessionSeed,
    session.handNumber,
    hand,
    liveDealGeneration,
  );
  const isDealCompleted = validCompletedDealKey === nextDealKey;
  const hadCancelledDeclaration = hand.awaitingDecision?.hadCancelledDeclaration ?? false;

  const isSameTurn =
    state.activeTurn !== null &&
    state.activeTurn.turnKey === nextTurnKey &&
    (liveDealGeneration === undefined ||
      state.activeTurn.dealGeneration === undefined ||
      state.activeTurn.dealGeneration === liveDealGeneration);

  if (isSameTurn && state.activeTurn !== null) {
    if (state.timedOutTurnKey === nextTurnKey) {
      return {
        ...state,
        status: 'timed-out',
        completedDealKey: validCompletedDealKey,
        completedDealGeneration: validCompletedDealGeneration,
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
          completedDealGeneration: validCompletedDealGeneration,
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
        completedDealGeneration: validCompletedDealGeneration,
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
        completedDealGeneration: validCompletedDealGeneration,
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
        completedDealGeneration: validCompletedDealGeneration,
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
      completedDealGeneration: validCompletedDealGeneration,
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
    ...(liveDealGeneration !== undefined ? { dealGeneration: liveDealGeneration } : {}),
    durationSeconds: configuredDurationSeconds,
    hadCancelledDeclaration,
  };

  if (!active) {
    return {
      ...state,
      status: isDealCompleted ? 'paused' : 'waiting-animation',
      activeTurn: nextTurn,
      completedDealKey: validCompletedDealKey,
      completedDealGeneration: validCompletedDealGeneration,
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
      completedDealGeneration: validCompletedDealGeneration,
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
    completedDealGeneration: validCompletedDealGeneration,
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

function matchesSupersededInfo(
  dealKey: string,
  dealGeneration: number | undefined | null,
  info: DealAnimationEndInfo,
): boolean {
  if (info.dealKey === undefined || info.sessionSeed === undefined) {
    return false;
  }
  if (dealKey !== info.dealKey) {
    return false;
  }
  if (
    info.dealGeneration !== undefined &&
    dealGeneration !== undefined &&
    dealGeneration !== null &&
    info.dealGeneration !== dealGeneration
  ) {
    return false;
  }
  return true;
}

export function applyDealAnimationEnd(
  state: TournamentClockState,
  info: DealAnimationEndInfo,
  session: SandboxSessionState | null,
  active: boolean,
  nowMs: number,
  liveDealGeneration?: number,
): TournamentClockState {
  if (info.outcome === 'superseded') {
    const clearCompleted =
      state.completedDealKey !== null &&
      matchesSupersededInfo(state.completedDealKey, state.completedDealGeneration, info);
    const nextCompletedKey = clearCompleted ? null : state.completedDealKey;
    const nextCompletedGen = clearCompleted ? null : state.completedDealGeneration;

    if (
      state.activeTurn !== null &&
      matchesSupersededInfo(state.activeTurn.dealKey, state.activeTurn.dealGeneration, info)
    ) {
      const liveDealKey =
        session !== null &&
        session.phase === 'in-hand' &&
        session.hand !== null &&
        session.hand.phase === 'betting'
          ? computeDealKey(
              session.sessionSeed,
              session.handNumber,
              session.hand.street,
              session.hand.board.length,
            )
          : null;
      const liveMatchesTurn =
        liveDealKey === state.activeTurn.dealKey &&
        (liveDealGeneration === undefined ||
          state.activeTurn.dealGeneration === undefined ||
          state.activeTurn.dealGeneration === liveDealGeneration);

      if (!liveMatchesTurn) {
        return {
          ...state,
          status: 'idle',
          activeTurn: null,
          completedDealKey: nextCompletedKey,
          completedDealGeneration: nextCompletedGen,
          deadlineMs: null,
          remainingMs: state.configuredDurationSeconds * 1000,
          remainingSeconds: state.configuredDurationSeconds,
          lastTickedSecond: null,
        };
      }

      if (state.status === 'running') {
        return {
          ...state,
          status: 'waiting-animation',
          completedDealKey: nextCompletedKey,
          completedDealGeneration: nextCompletedGen,
          deadlineMs: null,
          remainingMs: state.activeTurn.durationSeconds * 1000,
          remainingSeconds: state.activeTurn.durationSeconds,
          lastTickedSecond: null,
        };
      }
    }

    return clearCompleted
      ? { ...state, completedDealKey: null, completedDealGeneration: null }
      : state;
  }

  // outcome === 'completed'
  // Strict provenance + live-state guard: never stamp an older or unidentified completion onto live state.
  if (
    session === null ||
    session.phase !== 'in-hand' ||
    session.hand === null ||
    session.hand.phase !== 'betting' ||
    session.handNumber !== info.handNumber ||
    session.hand.street !== info.street
  ) {
    return state;
  }

  if (info.sessionSeed === undefined || info.dealKey === undefined) {
    return state;
  }

  const expectedDealKey = computeDealKey(
    session.sessionSeed,
    session.handNumber,
    session.hand.street,
    session.hand.board.length,
  );
  if (info.sessionSeed !== session.sessionSeed || info.dealKey !== expectedDealKey) {
    return state;
  }

  if (
    info.dealGeneration !== undefined &&
    liveDealGeneration !== undefined &&
    info.dealGeneration !== liveDealGeneration
  ) {
    return state;
  }

  const nextCompletedGen = info.dealGeneration ?? liveDealGeneration ?? null;

  // Idempotent guard: repeated completion for an already-completed deal must not rewrite state
  // (preserving paused remainingMs, running deadlineMs, and lastTickedSecond).
  if (
    state.completedDealKey === expectedDealKey &&
    state.completedDealGeneration === nextCompletedGen
  ) {
    return state;
  }

  const nextState: TournamentClockState = {
    ...state,
    completedDealKey: expectedDealKey,
    completedDealGeneration: nextCompletedGen,
  };

  if (
    nextState.activeTurn !== null &&
    nextState.activeTurn.dealKey === expectedDealKey &&
    (nextCompletedGen === null ||
      nextState.activeTurn.dealGeneration === undefined ||
      nextState.activeTurn.dealGeneration === nextCompletedGen) &&
    nextState.timedOutTurnKey !== nextState.activeTurn.turnKey
  ) {
    if (!active) {
      if (nextState.status === 'paused') {
        return nextState;
      }
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
  private timerSeq = 0;

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

  private getLiveDealGeneration(): number | undefined {
    return this.controller?.getDealGeneration?.();
  }

  private getLiveReducedMotion(): boolean | undefined {
    return this.controller?.isEffectiveReducedMotion?.();
  }

  private clearScheduledTimer(): void {
    this.timerSeq += 1;
    if (this.timerId !== null) {
      this.clearTimeoutFn(this.timerId);
      this.timerId = null;
    }
  }

  private commitState(next: TournamentClockState): void {
    const prev = this.state;
    const changed = next !== prev;
    this.state = next;
    const scheduleAffected =
      !this.getEffectiveActive() ||
      next.status !== prev.status ||
      next.deadlineMs !== prev.deadlineMs ||
      next.activeTurn?.turnKey !== prev.activeTurn?.turnKey ||
      (next.status === 'running' && this.timerId === null);
    if (scheduleAffected) {
      this.syncTimer();
    }
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
    const scheduledTurnKey = this.state.activeTurn?.turnKey ?? null;
    const scheduledTimerSeq = ++this.timerSeq;
    this.timerId = this.setTimeoutFn(() => {
      if (scheduledTimerSeq !== this.timerSeq) {
        return;
      }
      this.timerId = null;
      this.handleTimerWakeup(scheduledTimerSeq, scheduledTurnKey);
    }, delay);
  }

  private handleTimerWakeup(timerSeq: number, scheduledTurnKey: string | null): void {
    if (
      !this.getEffectiveActive() ||
      timerSeq !== this.timerSeq ||
      scheduledTurnKey === null ||
      this.state.activeTurn?.turnKey !== scheduledTurnKey
    ) {
      return;
    }

    const liveSession = this.controller?.getState() ?? null;
    const liveGeneration = this.getLiveDealGeneration();
    const liveTurnKey =
      liveSession !== null &&
      isFreeHeroDecisionTurn(liveSession) &&
      liveSession.hand !== null
        ? computeTurnKey(
            liveSession.sessionSeed,
            liveSession.handNumber,
            liveSession.hand,
            liveGeneration,
          )
        : null;
    if (liveTurnKey !== scheduledTurnKey) {
      this.commitState(
        reconcileSessionSnapshot(
          this.state,
          liveSession,
          this.getEffectiveActive(),
          this.now(),
          liveGeneration,
          this.getLiveReducedMotion(),
        ),
      );
      return;
    }

    const nowMs = this.now();
    const result = advanceTournamentClock(this.state, nowMs);
    this.commitState(result.nextState);

    if (result.playTickUrgent !== null) {
      this.controller?.playTimerTick?.(result.playTickUrgent);
    }

    if (result.timeoutTurnKey !== null) {
      const postSession = this.controller?.getState() ?? null;
      if (
        postSession !== null &&
        isFreeHeroDecisionTurn(postSession) &&
        postSession.hand !== null &&
        computeTurnKey(
          postSession.sessionSeed,
          postSession.handNumber,
          postSession.hand,
          this.getLiveDealGeneration(),
        ) === result.timeoutTurnKey
      ) {
        this.controller?.autoTimeoutHeroAction(result.timeoutTurnKey);
      }
    }
  }

  public unlockAudio(): boolean {
    return this.controller?.unlockAudio?.() ?? false;
  }

  public setController(api: SandboxExternalApi | null): void {
    this.controller = api;
    const session = api?.getState() ?? null;
    const next = reconcileSessionSnapshot(
      this.state,
      session,
      this.getEffectiveActive(),
      this.now(),
      this.getLiveDealGeneration(),
      this.getLiveReducedMotion(),
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
      this.getLiveDealGeneration(),
      this.getLiveReducedMotion(),
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
      this.getLiveDealGeneration(),
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
    const resumed = reconcileSessionSnapshot(
      this.state,
      session,
      true,
      this.now(),
      this.getLiveDealGeneration(),
      this.getLiveReducedMotion(),
    );
    this.commitState(resumed);
  }

  public dispose(): void {
    this.mounted = false;
    this.clearScheduledTimer();
    this.state = pauseTournamentClock(this.state, this.now());
  }
}
