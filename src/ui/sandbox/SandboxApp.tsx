import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  calculatePots,
  chipValue,
  DENOMINATIONS,
  emptyChips,
  getLegalActions,
  type ChipCounts,
  type Denomination,
  type HandExchangeRequest,
  type SeatState,
  type TableSeat as BoundarySeat,
} from '../../engine';
import { ChipSvg } from './assets/ChipSvg';
import { PlayingCard } from './assets/PlayingCard';
import { SandboxAudioEngine } from './audio';
import { BoundaryPanel } from './components/BoundaryPanel';
import { ExchangeModal } from './components/ExchangeModal';
import { HandReviewModal } from './components/HandReviewModal';
import { HeroControls } from './components/HeroControls';
import { LedgerDrawer } from './components/LedgerDrawer';
import { SettingsDrawer } from './components/SettingsDrawer';
import { TableSeat } from './components/TableSeat';
import {
  applySettingsUpdate,
  cashOutPlayerAtBoundary,
  clearStagedChips,
  createSandboxSession,
  enterHandBoundary,
  exchangeAtBoundary,
  exchangeInHand,
  getAvailableHeroStackAfterStaged,
  getHeroActionValidation,
  getHeroTurnIdentity,
  getPersistedSettingsForSession,
  getSeatRivalMetadata,
  inviteRivalAtBoundary,
  isSeatCardsRevealed,
  performHeroAction,
  performHeroAutoTimeout,
  performHeroOutOfTurn,
  rebuyPlayerAtBoundary,
  requestHeroLeave,
  seatHeroAtBoundary,
  settleAwaitingPayout,
  stageChip,
  startNextHand,
  stepOneBotTurn,
  toggleAudioMute,
  unstageChip,
  unstageLastChip,
} from './controller';
import {
  syncDealAnimationLifecycle,
  type DealAnimState,
  type PendingDealDescriptor,
} from './dealAnimation';
import {
  formatChipBreakdown,
  formatCardShort,
  formatNumberVi,
  formatStreetLabel,
  formatTimelineEventVi,
  getPlayerName,
  tTerm,
} from './format';
import { loadSandboxSettings, sanitizeSettings, saveSandboxSettings } from './settings';
import {
  HERO_PLAYER_ID,
  type SandboxAppProps,
  type SandboxSessionState,
  type SandboxSettings,
} from './types';
import './sandbox.css';

const DEAL_ANIMATION_MS = 320;

function detectSystemReducedMotion(): boolean {
  try {
    if (
      typeof globalThis !== 'undefined' &&
      typeof globalThis.window !== 'undefined' &&
      typeof globalThis.window.matchMedia === 'function'
    ) {
      return globalThis.window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  } catch {
    // Ignore in non-browser environments
  }
  return false;
}

export function SandboxApp({
  initialSeed,
  initialSettings,
  onPracticeSpot,
  mode = 'sandbox',
  timerSlot,
  onDealAnimationEnd,
  onHeroTurnChange,
  onControllerReady,
  disableMidHandFeedback = false,
  storage,
  renderTableView,
  hideTableSettings = false,
}: SandboxAppProps) {
  const [session, setSession] = useState<SandboxSessionState>(() => {
    const loaded = loadSandboxSettings(storage);
    const mergedSettings: Partial<SandboxSettings> = {
      ...loaded.settings,
      ...initialSettings,
      audio: {
        ...loaded.settings.audio,
        ...initialSettings?.audio,
      },
    };
    const created = createSandboxSession({
      seed: initialSeed,
      settings: mergedSettings,
    });
    if (loaded.recoveredFromCorrupt) {
      return {
        ...created,
        statusNotice: {
          tone: 'warning',
          message: 'Dữ liệu cài đặt lưu cục bộ bị lỗi — đã tự khôi phục về mặc định an toàn.',
        },
      };
    }
    return created;
  });

  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [botsPaused, setBotsPaused] = useState(false);
  const [expandAllSeatDetails, setExpandAllSeatDetails] = useState(false);
  const [systemReducedMotion, setSystemReducedMotion] = useState<boolean>(() =>
    detectSystemReducedMotion(),
  );

  const effectiveReducedMotion = session.appliedSettings.reducedMotion || systemReducedMotion;
  const lang = session.appliedSettings.terminology;

  const dealGenerationRef = useRef(1);
  const activeDealKey =
    session.phase === 'in-hand' && session.hand !== null
      ? `${session.sessionSeed}:${session.handNumber}:${session.hand.street}:${session.hand.board.length}`
      : null;
  const dealKey = activeDealKey !== null ? `${activeDealKey}:g${dealGenerationRef.current}` : null;

  const [dealAnimState, setDealAnimState] = useState<DealAnimState>(() => {
    if (dealKey === null) {
      return 'idle';
    }
    return effectiveReducedMotion ? 'ready' : 'animating';
  });

  const sessionRef = useRef<SandboxSessionState>(session);
  sessionRef.current = session;

  const effectiveReducedMotionRef = useRef<boolean>(effectiveReducedMotion);
  effectiveReducedMotionRef.current = effectiveReducedMotion;

  const onDealAnimationEndRef = useRef<SandboxAppProps['onDealAnimationEnd']>(onDealAnimationEnd);
  onDealAnimationEndRef.current = onDealAnimationEnd;

  const audioRef = useRef<SandboxAudioEngine | null>(null);
  if (audioRef.current === null) {
    audioRef.current = new SandboxAudioEngine(session.appliedSettings.audio);
  }

  const processedTurnKeyRef = useRef<string | null>(null);
  const pendingDealRef = useRef<PendingDealDescriptor | null>(null);
  const completedDealKeyRef = useRef<string | null>(null);
  const lastAudioSessionSeedRef = useRef<string>(session.sessionSeed);

  // Listen to OS prefers-reduced-motion changes
  useEffect(() => {
    if (
      typeof globalThis === 'undefined' ||
      typeof globalThis.window === 'undefined' ||
      typeof globalThis.window.matchMedia !== 'function'
    ) {
      return;
    }
    const mq = globalThis.window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (ev: MediaQueryListEvent) => setSystemReducedMotion(ev.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Sync audio settings & dispose on unmount
  useEffect(() => {
    audioRef.current?.updateSettings(session.appliedSettings.audio);
  }, [session.appliedSettings.audio]);

  useEffect(() => {
    return () => {
      audioRef.current?.dispose();
    };
  }, []);

  // Unlock audio only on user gesture
  const unlockAudio = useCallback(() => {
    audioRef.current?.unlockFromUserGesture();
  }, []);

  // Play deduplicated timeline event sounds (resetting dedup when starting a new session)
  useEffect(() => {
    const engine = audioRef.current;
    if (!engine) {
      return;
    }
    if (lastAudioSessionSeedRef.current !== session.sessionSeed) {
      engine.clearPlayedHistory();
      lastAudioSessionSeedRef.current = session.sessionSeed;
    }
    const hand = session.hand;
    if (session.phase !== 'in-hand' || hand === null) {
      return;
    }
    hand.timeline.forEach((ev, idx) => {
      engine.playTimelineEventOnce(`${session.handNumber}:${idx}`, ev);
    });
  }, [session.sessionSeed, session.phase, session.handNumber, session.hand]);

  // Expose external controller API for P5 Tournament timeout (O1/O2) and timer audio channel (O5).
  // Registered before deal animation lifecycle so controller.getState() is ready on reduced-motion mount.
  useEffect(() => {
    if (!onControllerReady) {
      return;
    }
    onControllerReady({
      autoTimeoutHeroAction: (expectedTurnKey?: string) => {
        const capturedGeneration = dealGenerationRef.current;
        const capturedTurnKey =
          expectedTurnKey ??
          getHeroTurnIdentity(sessionRef.current, capturedGeneration) ??
          undefined;
        setSession((prev) => {
          if (dealGenerationRef.current !== capturedGeneration) {
            return prev;
          }
          return performHeroAutoTimeout(prev, capturedTurnKey, dealGenerationRef.current);
        });
      },
      getState: () => sessionRef.current,
      getDealGeneration: () => dealGenerationRef.current,
      isEffectiveReducedMotion: () => effectiveReducedMotionRef.current,
      unlockAudio: () => audioRef.current?.unlockFromUserGesture() ?? false,
      playTimerTick: (urgent?: boolean) => {
        audioRef.current?.playTimerTick(urgent);
      },
    });
  }, [onControllerReady]);

  // Observable deal / reveal animation lifecycle (O3 readiness for P5 Tournament)
  useEffect(() => {
    return syncDealAnimationLifecycle({
      dealKey,
      effectiveReducedMotion,
      durationMs: DEAL_ANIMATION_MS,
      getDealInfo: () => {
        const currentSession = sessionRef.current;
        const currentHand = currentSession.hand;
        if (currentSession.phase !== 'in-hand' || currentHand === null) {
          return null;
        }
        return {
          handNumber: currentSession.handNumber,
          street: currentHand.street,
          eventCount: currentHand.timeline.length,
          sessionSeed: currentSession.sessionSeed,
          dealKey: `${currentSession.sessionSeed}:${currentSession.handNumber}:${currentHand.street}:${currentHand.board.length}`,
          dealGeneration: dealGenerationRef.current,
        };
      },
      pendingDealRef,
      completedDealKeyRef,
      onDealAnimationEndRef,
      setDealAnimState,
    });
  }, [dealKey, effectiveReducedMotion]);

  // Notify parent when Hero turn state changes
  const activeHand = session.phase === 'in-hand' ? session.hand : null;
  const isHeroTurn =
    activeHand !== null &&
    activeHand.phase === 'betting' &&
    activeHand.activePlayerId === HERO_PLAYER_ID;
  const heroTurnKey =
    activeHand !== null
      ? `${session.sessionSeed}:${session.handNumber}:${activeHand.phase}:${activeHand.activePlayerId}:${activeHand.timeline.length}:${dealGenerationRef.current}`
      : 'between';

  const appliedTimerSeconds = session.appliedSettings.tournamentTimerSeconds;
  const pendingTimerSeconds = session.pendingSettings?.tournamentTimerSeconds ?? null;

  useEffect(() => {
    if (!onHeroTurnChange) {
      return;
    }
    const legal = activeHand !== null && isHeroTurn ? getLegalActions(activeHand) : null;
    onHeroTurnChange({
      active: isHeroTurn,
      hand: activeHand,
      legalActions: legal,
      hadCancelledDeclaration: activeHand?.awaitingDecision?.hadCancelledDeclaration ?? false,
    });
  }, [
    heroTurnKey,
    isHeroTurn,
    activeHand,
    appliedTimerSeconds,
    pendingTimerSeconds,
    effectiveReducedMotion,
    onHeroTurnChange,
  ]);

  // Pause bot auto-stepping while modals are open or while hero is staging an out-of-turn bet
  const heroStagingOutOfTurn =
    activeHand !== null &&
    activeHand.phase === 'betting' &&
    activeHand.activePlayerId !== HERO_PLAYER_ID &&
    chipValue(session.stagedChips) > 0;

  const isBotStepDue =
    activeHand !== null &&
    activeHand.phase === 'betting' &&
    activeHand.activePlayerId !== null &&
    (activeHand.activePlayerId !== HERO_PLAYER_ID || session.pendingHeroLeave);

  const botTurnKey = isBotStepDue
    ? `${session.handNumber}:${session.stepCounter}:${activeHand.timeline.length}:${activeHand.activePlayerId}`
    : null;

  const botExecutionPaused =
    botsPaused || exchangeOpen || settingsOpen || ledgerOpen || reviewOpen || heroStagingOutOfTurn;

  useEffect(() => {
    if (botTurnKey === null || botExecutionPaused) {
      return;
    }
    if (processedTurnKeyRef.current === botTurnKey) {
      return;
    }

    const delay = session.appliedSettings.botSpeedMs;
    const timer = globalThis.setTimeout(() => {
      if (processedTurnKeyRef.current === botTurnKey) {
        return;
      }
      processedTurnKeyRef.current = botTurnKey;
      setSession((prev) => stepOneBotTurn(prev));
    }, delay);

    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [botTurnKey, botExecutionPaused, session.appliedSettings.botSpeedMs]);

  const validation = useMemo(() => getHeroActionValidation(session), [session]);
  const availableHeroStack = useMemo(() => getAvailableHeroStackAfterStaged(session), [session]);

  // Keyboard shortcuts (Escape closes modals; 1-4 stage chips; Backspace undoes last chip)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      unlockAudio();
      if (event.key === 'Escape') {
        if (exchangeOpen) setExchangeOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (ledgerOpen) setLedgerOpen(false);
        else if (reviewOpen) setReviewOpen(false);
        return;
      }

      if (exchangeOpen || settingsOpen || ledgerOpen || reviewOpen) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA')
      ) {
        return;
      }

      if (!validation.isHeroTurn && !validation.canDeclareOutOfTurn) {
        return;
      }

      const denomIndexMap: Record<string, Denomination> = {
        '1': 5,
        '2': 10,
        '3': 50,
        '4': 100,
      };
      const mapped = denomIndexMap[event.key];
      if (mapped !== undefined) {
        event.preventDefault();
        audioRef.current?.playChip(mapped);
        setSession((prev) => stageChip(prev, mapped));
      } else if (event.key === 'Backspace' && validation.stagedValue > 0) {
        event.preventDefault();
        setSession((prev) => unstageLastChip(prev));
      }
    };

    if (typeof globalThis !== 'undefined' && typeof globalThis.window !== 'undefined') {
      globalThis.window.addEventListener('keydown', handleKeyDown);
      return () => globalThis.window.removeEventListener('keydown', handleKeyDown);
    }
    return undefined;
  }, [
    exchangeOpen,
    settingsOpen,
    ledgerOpen,
    reviewOpen,
    unlockAudio,
    validation.isHeroTurn,
    validation.canDeclareOutOfTurn,
    validation.stagedValue,
  ]);

  const handleStageChip = useCallback(
    (denom: Denomination) => {
      unlockAudio();
      audioRef.current?.playChip(denom);
      setSession((prev) => stageChip(prev, denom));
    },
    [unlockAudio],
  );

  const handleUnstageChip = useCallback(
    (denom: Denomination) => {
      unlockAudio();
      setSession((prev) => unstageChip(prev, denom));
    },
    [unlockAudio],
  );

  const handleUndoLastChip = useCallback(() => {
    unlockAudio();
    setSession((prev) => unstageLastChip(prev));
  }, [unlockAudio]);

  const handleClearStaged = useCallback(() => {
    unlockAudio();
    setSession((prev) => clearStagedChips(prev));
  }, [unlockAudio]);

  const handleHeroAction = useCallback(
    (type: 'fold' | 'check' | 'call' | 'bet' | 'raise') => {
      unlockAudio();
      setSession((prev) => performHeroAction(prev, type));
    },
    [unlockAudio],
  );

  const handleHeroOutOfTurn = useCallback(
    (type: 'check' | 'call' | 'bet' | 'raise') => {
      unlockAudio();
      setSession((prev) => performHeroOutOfTurn(prev, type));
    },
    [unlockAudio],
  );

  const handleExchangeInHand = useCallback(
    (request: HandExchangeRequest) => {
      unlockAudio();
      audioRef.current?.playChip(10);
      setSession((prev) => exchangeInHand(prev, request));
    },
    [unlockAudio],
  );

  const handleExchangeAtBoundary = useCallback(
    (fromPlayerId: string, toPlayerId: string, give: ChipCounts, receive: ChipCounts) => {
      unlockAudio();
      audioRef.current?.playChip(10);
      setSession((prev) => exchangeAtBoundary(prev, fromPlayerId, toPlayerId, give, receive));
    },
    [unlockAudio],
  );

  const handleSettlePayout = useCallback(() => {
    unlockAudio();
    setSession((prev) => settleAwaitingPayout(prev));
  }, [unlockAudio]);

  const handleApplySettings = useCallback(
    (next: SandboxSettings, applyMode: 'apply-boundary' | 'new-session') => {
      unlockAudio();
      const { settings: sanitized } = sanitizeSettings(next);
      audioRef.current?.updateSettings(sanitized.audio);
      if (applyMode === 'new-session') {
        audioRef.current?.clearPlayedHistory();
        completedDealKeyRef.current = null;
        dealGenerationRef.current += 1;
      }
      saveSandboxSettings(sanitized, storage);
      processedTurnKeyRef.current = null;
      setSession((prev) => applySettingsUpdate(prev, sanitized, applyMode));
    },
    [storage, unlockAudio],
  );

  const handleToggleMute = useCallback(() => {
    unlockAudio();
    const next = toggleAudioMute(sessionRef.current);
    sessionRef.current = next;
    audioRef.current?.updateSettings(next.appliedSettings.audio);
    saveSandboxSettings(getPersistedSettingsForSession(next), storage);
    setSession(next);
  }, [storage, unlockAudio]);

  const handleTestAudio = useCallback(
    (channel: 'chips' | 'cards' | 'timer', draft: SandboxSettings) => {
      unlockAudio();
      audioRef.current?.updateSettings(draft.audio);
      if (channel === 'chips') {
        audioRef.current?.playChip(50);
      } else if (channel === 'cards') {
        audioRef.current?.playCardDeal(2);
      } else {
        audioRef.current?.playTimerTick(true);
      }
    },
    [unlockAudio],
  );

  const handleNextHand = useCallback(() => {
    unlockAudio();
    setReviewOpen(false);
    processedTurnKeyRef.current = null;
    setSession((prev) => startNextHand(prev));
  }, [unlockAudio]);

  const handleOpenBoundary = useCallback(() => {
    unlockAudio();
    setReviewOpen(false);
    setSession((prev) => enterHandBoundary(prev));
  }, [unlockAudio]);

  // Derived table view values
  const heroSeat = activeHand?.seats.find((s) => s.playerId === HERO_PLAYER_ID) ?? null;
  const potChips = activeHand?.pot ?? emptyChips();
  const potValue = chipValue(potChips);
  const potSlices = useMemo(() => {
    if (!activeHand || potValue === 0) {
      return [];
    }
    try {
      return calculatePots(
        activeHand.seats.map((s) => ({
          playerId: s.playerId,
          amount: s.unsettledContribution,
          folded: s.status === 'folded',
        })),
      ).pots;
    } catch {
      return [];
    }
  }, [activeHand, potValue]);

  const winnerIds = useMemo(() => {
    const set = new Set<string>();
    if (!activeHand?.outcome) {
      return set;
    }
    if (activeHand.outcome.kind === 'fold-win') {
      set.add(activeHand.outcome.winnerId);
    } else {
      for (const p of activeHand.outcome.resolution.totalPayouts) {
        if (p.amount > 0) {
          set.add(p.playerId);
        }
      }
    }
    return set;
  }, [activeHand]);

  const latestEventText = useMemo(() => {
    if (!activeHand || activeHand.timeline.length === 0) {
      return null;
    }
    const last = activeHand.timeline[activeHand.timeline.length - 1]!;
    return formatTimelineEventVi(last, session.seatProfiles, lang);
  }, [activeHand, session.seatProfiles, lang]);

  const seatsToRender: readonly (SeatState | BoundarySeat)[] =
    session.phase === 'in-hand' && activeHand !== null
      ? activeHand.seats
      : (session.boundary?.seats ?? []);

  const actorId = activeHand?.phase === 'betting' ? activeHand.activePlayerId : null;
  const tableView = renderTableView?.({
    pot: potValue,
    call: activeHand?.phase === 'betting' && heroSeat?.status === 'active'
      ? Math.min(Math.max(0, activeHand.currentBet - heroSeat.streetContribution), chipValue(heroSeat.stack))
      : 0,
    heroCards: heroSeat?.holeCards.map(formatCardShort) ?? [],
    board: activeHand?.board.map(formatCardShort) ?? [],
    street: activeHand?.street ?? null,
    occupiedRivals: seatsToRender.flatMap((seat) => {
      const rival = session.seatProfiles[seat.playerId]?.rivalId;
      return rival ? [rival] : [];
    }),
    activeRival: actorId ? session.seatProfiles[actorId]?.rivalId ?? null : null,
    activePlayerName: actorId ? getPlayerName(actorId, session.seatProfiles) : null,
    reducedMotion: effectiveReducedMotion,
  });

  const canPracticeCurrentSpot =
    onPracticeSpot !== undefined &&
    !disableMidHandFeedback &&
    activeHand !== null &&
    activeHand.phase === 'betting' &&
    heroSeat !== null &&
    activeHand.activePlayerId === HERO_PLAYER_ID &&
    getLegalActions(activeHand) !== null;

  const importantSpotBanner =
    !disableMidHandFeedback &&
    session.appliedSettings.pauseOnImportantSpot &&
    canPracticeCurrentSpot &&
    activeHand !== null &&
    activeHand.currentBet > 0;

  return (
    <div
      className={`accate-sandbox${effectiveReducedMotion ? ' is-reduced-motion' : ''}`}
      onPointerDown={unlockAudio}
      data-mode={mode}
      data-phase={session.phase}
    >
      <header className="sb-topbar">
        <div className="sb-topbar__title">
          <h1>{mode === 'tournament' ? 'Accate Tournament' : 'Bàn Sandbox Accate'}</h1>
          <span className="sb-pill sb-pill--street sb-num">
            Ván #{session.handNumber}
            {activeHand
              ? ` · ${formatStreetLabel(activeHand.street, lang)} · ${tTerm('cap', lang)} ${activeHand.streetCap}`
              : ' · Giữa hai ván'}
          </span>
          {session.pendingSettings !== null && (
            <span className="sb-pill sb-pill--pending">Cài đặt mới áp dụng ván sau</span>
          )}
        </div>

        <nav className="sb-topbar__actions" aria-label="Điều khiển phụ của bàn">
          {session.phase === 'in-hand' && activeHand?.phase === 'betting' && (
            <button
              type="button"
              className="sb-btn sb-btn--ghost sb-btn--sm"
              onClick={() => setBotsPaused((p) => !p)}
              aria-pressed={botsPaused}
            >
              {botsPaused ? 'Tiếp tục bot' : 'Tạm dừng'}
            </button>
          )}
          <button
            type="button"
            className="sb-btn sb-btn--ghost sb-btn--sm"
            onClick={handleToggleMute}
            aria-pressed={session.appliedSettings.audio.muted}
          >
            {session.appliedSettings.audio.muted ? 'Đã tắt âm' : 'Âm thanh: Bật'}
          </button>
          <button
            type="button"
            className="sb-btn sb-btn--secondary sb-btn--sm"
            onClick={() => setLedgerOpen(true)}
          >
            Sổ phiên
          </button>
          {!hideTableSettings && <button
            type="button"
            className="sb-btn sb-btn--secondary sb-btn--sm"
            onClick={() => setSettingsOpen(true)}
          >
            Cài đặt
          </button>}
        </nav>
      </header>

      {session.statusNotice !== null && (
        <div
          className={`sb-notice sb-notice--${session.statusNotice.tone}`}
          role={session.statusNotice.tone === 'error' ? 'alert' : 'status'}
        >
          <div className="sb-notice__text">
            <strong>{session.statusNotice.message}</strong>
            {session.statusNotice.guidance && <span> {session.statusNotice.guidance}</span>}
          </div>
          <button
            type="button"
            className="sb-btn sb-btn--ghost sb-btn--xs"
            onClick={() => setSession((prev) => ({ ...prev, statusNotice: null }))}
            aria-label="Ẩn thông báo"
          >
            ×
          </button>
        </div>
      )}

      {importantSpotBanner && onPracticeSpot && activeHand && (
        <div className="sb-notice sb-notice--info" role="status">
          <span>Spot đối mặt cược {activeHand.currentBet} điểm — muốn chuyển nhanh sang Drill?</span>
          <button
            type="button"
            className="sb-btn sb-btn--accent sb-btn--xs"
            onClick={() => onPracticeSpot(activeHand, HERO_PLAYER_ID)}
          >
            Luyện spot này
          </button>
        </div>
      )}

      <main className="sb-main">
        <div className="sb-primary-stage">
          <div className="sb-table-rail">
            <div className="sb-table-felt">
              <section
                className="sb-felt-center"
                aria-label="Khu vực bài chung và Pot"
                data-deal-state={dealAnimState}
              >
                {renderTableView && tableView}
                <div className="sb-pot-display">
                  {!renderTableView && (
                  <div className="sb-pot-display__main">
                    <span className="sb-label">{tTerm('pot', lang)}</span>
                    <strong className="sb-pot-value sb-num">{formatNumberVi(potValue)}</strong>
                  </div>
                  )}
                  {potValue > 0 && (
                    <div className="sb-pot-display__chips">
                      {DENOMINATIONS.map((d) =>
                        potChips[d] > 0 ? (
                          <span key={d} className="sb-chip-pill sb-num">
                            <ChipSvg denomination={d} size={16} decorative />
                            <span>×{potChips[d]}</span>
                          </span>
                        ) : null,
                      )}
                    </div>
                  )}
                  {potSlices.length > 1 && (
                    <div className="sb-side-pots sb-num">
                      {potSlices.map((slice) => (
                        <span key={slice.index} className="sb-pill sb-pill--bet">
                          {slice.index === 0 ? 'Main' : `Side ${slice.index}`}: {slice.amount}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {!renderTableView && <div className="sb-board" aria-label="5 lá bài chung">
                  {[0, 1, 2, 3, 4].map((slotIdx) => {
                    const card = activeHand?.board[slotIdx] ?? null;
                    return card !== null ? (
                      <PlayingCard
                        key={`${session.handNumber}-${slotIdx}-${card.rank}-${card.suit}`}
                        card={card}
                        size="lg"
                        animated={!effectiveReducedMotion}
                      />
                    ) : (
                      <div key={slotIdx} className="sb-board-slot" aria-hidden="true" />
                    );
                  })}
                </div>}

                <div className="sb-turn-status" aria-live="polite">
                  {activeHand !== null && activeHand.phase === 'betting' && activeHand.activePlayerId && (
                    <p className="sb-turn-status__primary">
                      Lượt hiện tại:{' '}
                      <strong>{getPlayerName(activeHand.activePlayerId, session.seatProfiles)}</strong>
                      {activeHand.currentBet > 0 && (
                        <span className="sb-num">
                          {' '}
                          · Mức cược: <strong>{activeHand.currentBet}</strong> / {activeHand.streetCap}
                        </span>
                      )}
                      {heroStagingOutOfTurn && (
                        <span className="sb-pill sb-pill--pending">
                          Bot tạm dừng khi bạn đang ghép chip hô sớm
                        </span>
                      )}
                    </p>
                  )}

                  {activeHand !== null && activeHand.phase === 'complete' && (
                    <div className="sb-turn-status__complete">
                      <p>
                        {activeHand.outcome?.kind === 'fold-win'
                          ? `${getPlayerName(activeHand.outcome.winnerId, session.seatProfiles)} thắng pot ${activeHand.outcome.potAmount} điểm (mọi người fold).`
                          : activeHand.outcome?.kind === 'showdown'
                            ? `Showdown: ${activeHand.outcome.resolution.totalPayouts
                                .map((p) => `${getPlayerName(p.playerId, session.seatProfiles)} +${p.amount}`)
                                .join(' · ')}`
                            : 'Ván đã hoàn tất.'}
                      </p>
                      <div className="sb-turn-status__btns">
                        {session.lastHandReview && (
                          <button
                            type="button"
                            className="sb-btn sb-btn--secondary sb-btn--sm"
                            onClick={() => setReviewOpen(true)}
                          >
                            Xem lại & Phân tích
                          </button>
                        )}
                        <button
                          type="button"
                          className="sb-btn sb-btn--ghost sb-btn--sm"
                          onClick={handleOpenBoundary}
                        >
                          Quản lý ghế / Rebuy
                        </button>
                        <button
                          type="button"
                          className="sb-btn sb-btn--primary sb-btn--sm"
                          onClick={handleNextHand}
                        >
                          Chia ván mới
                        </button>
                      </div>
                    </div>
                  )}

                  {latestEventText && (
                    <p className="sb-turn-status__log">{latestEventText}</p>
                  )}

                  {activeHand !== null && (
                    <p className="sb-turn-status__bank sb-num">
                      Kho chip: {formatNumberVi(chipValue(activeHand.bank))} ({formatChipBreakdown(activeHand.bank)})
                    </p>
                  )}
                </div>
              </section>
            </div>
          </div>

          {session.phase === 'in-hand' && activeHand !== null ? (
            <HeroControls
              heroCards={heroSeat?.holeCards ?? null}
              availableStack={availableHeroStack}
              stagedChips={session.stagedChips}
              validation={validation}
              potValue={potValue}
              streetCap={activeHand.streetCap}
              terminology={lang}
              opportunityKey={`${session.sessionSeed}:${session.handNumber}:${activeHand.phase}:${activeHand.street}:${activeHand.activePlayerId ?? 'none'}:${activeHand.currentBet}:${activeHand.timeline.length}:${session.stepCounter}`}
              isHeroSeated={heroSeat !== null}
              pendingHeroLeave={session.pendingHeroLeave}
              isAwaitingPayout={activeHand.phase === 'awaiting-payout'}
              isHandComplete={activeHand.phase === 'complete'}
              disableMidHandFeedback={disableMidHandFeedback}
              timerSlot={timerSlot}
              canPracticeSpot={canPracticeCurrentSpot}
              onStageChip={handleStageChip}
              onUnstageChip={handleUnstageChip}
              onUndoLastChip={handleUndoLastChip}
              onClearStaged={handleClearStaged}
              onAction={handleHeroAction}
              onDeclareOutOfTurn={handleHeroOutOfTurn}
              onOpenExchange={() => setExchangeOpen(true)}
              onRequestLeave={() => setSession((prev) => requestHeroLeave(prev))}
              onPracticeSpot={
                onPracticeSpot && activeHand
                  ? () => onPracticeSpot(activeHand, HERO_PLAYER_ID)
                  : undefined
              }
              onSettlePayout={handleSettlePayout}
              onOpenReview={session.lastHandReview ? () => setReviewOpen(true) : undefined}
              onNextHand={handleNextHand}
            />
          ) : session.boundary !== null ? (
            <BoundaryPanel
              boundary={session.boundary}
              seatProfiles={session.seatProfiles}
              hasPendingSettings={session.pendingSettings !== null}
              onRebuyPlayer={(pid) => setSession((prev) => rebuyPlayerAtBoundary(prev, pid))}
              onCashOutPlayer={(pid) => setSession((prev) => cashOutPlayerAtBoundary(prev, pid))}
              onInviteRival={() => setSession((prev) => inviteRivalAtBoundary(prev))}
              onSeatHeroBack={() => setSession((prev) => seatHeroAtBoundary(prev))}
              onOpenExchange={() => setExchangeOpen(true)}
              onStartNextHand={handleNextHand}
              onOpenReview={session.lastHandReview ? () => setReviewOpen(true) : undefined}
            />
          ) : null}
        </div>

        <section
          className="sb-seats-panel"
          aria-label={`Danh sách ${seatsToRender.length} ghế trên bàn`}
        >
          <div className="sb-seats-panel__head">
            <div className="sb-seats-panel__title">
              <h2>Ghế trên bàn</h2>
              <span className="sb-pill sb-pill--street sb-num">{seatsToRender.length} ghế</span>
            </div>
            <button
              type="button"
              className="sb-btn sb-btn--ghost sb-btn--xs sb-seats-panel__expand-all"
              onClick={() => setExpandAllSeatDetails((prev) => !prev)}
              aria-pressed={expandAllSeatDetails}
            >
              {expandAllSeatDetails ? 'Thu gọn chip' : 'Hiện chip tất cả'}
            </button>
          </div>

          <div className="sb-seats-grid">
            {seatsToRender.map((seat) => {
              const inHandSeat = 'holeCards' in seat ? seat : null;
              const isHero = seat.playerId === HERO_PLAYER_ID;
              const metadata = getSeatRivalMetadata(session, seat.playerId);
              const revealed =
                inHandSeat !== null && activeHand !== null
                  ? isSeatCardsRevealed(activeHand, seat.playerId)
                  : false;

              return (
                <TableSeat
                  key={seat.playerId}
                  seatIndex={seat.seatIndex}
                  playerId={seat.playerId}
                  displayName={getPlayerName(seat.playerId, session.seatProfiles)}
                  isHero={isHero}
                  rivalMetadata={metadata}
                  stack={seat.stack}
                  holeCards={inHandSeat !== null ? inHandSeat.holeCards : null}
                  cardsRevealed={revealed}
                  status={inHandSeat !== null ? inHandSeat.status : 'active'}
                  streetContribution={inHandSeat !== null ? inHandSeat.streetContribution : 0}
                  isActiveTurn={
                    activeHand !== null &&
                    activeHand.phase === 'betting' &&
                    activeHand.activePlayerId === seat.playerId
                  }
                  isDealer={
                    activeHand !== null
                      ? activeHand.dealerSeatIndex === seat.seatIndex
                      : session.boundary?.lastDealerSeatIndex === seat.seatIndex
                  }
                  isOpener={
                    activeHand !== null && activeHand.openerPlayerId === seat.playerId
                  }
                  declaration={inHandSeat !== null ? inHandSeat.declaration : null}
                  isWinner={winnerIds.has(seat.playerId)}
                  isBetweenHands={session.phase === 'between-hands'}
                  terminology={lang}
                  forceExpandDetails={expandAllSeatDetails}
                  onBoundaryRebuy={
                    session.phase === 'between-hands'
                      ? (pid) => setSession((prev) => rebuyPlayerAtBoundary(prev, pid))
                      : undefined
                  }
                  onBoundaryCashOut={
                    session.phase === 'between-hands'
                      ? (pid) => setSession((prev) => cashOutPlayerAtBoundary(prev, pid))
                      : undefined
                  }
                />
              );
            })}
          </div>
        </section>
      </main>

      {exchangeOpen && (
        <ExchangeModal
          mode={session.phase}
          hand={session.hand}
          boundary={session.boundary}
          seatProfiles={session.seatProfiles}
          onExchangeInHand={handleExchangeInHand}
          onExchangeAtBoundary={handleExchangeAtBoundary}
          onSettlePayout={
            session.hand?.phase === 'awaiting-payout' ? handleSettlePayout : undefined
          }
          onClose={() => setExchangeOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsDrawer
          appliedSettings={session.appliedSettings}
          pendingSettings={session.pendingSettings}
          isInHand={session.phase === 'in-hand' && session.hand?.phase === 'betting'}
          hasPracticeSpotCallback={onPracticeSpot !== undefined && !disableMidHandFeedback}
          onApply={handleApplySettings}
          onTestAudio={handleTestAudio}
          onClose={() => {
            audioRef.current?.updateSettings(sessionRef.current.appliedSettings.audio);
            setSettingsOpen(false);
          }}
        />
      )}

      {ledgerOpen && (
        <LedgerDrawer
          ledgerEvents={session.ledgerEvents}
          phase={session.phase}
          hand={session.hand}
          boundary={session.boundary}
          seatProfiles={session.seatProfiles}
          onClose={() => setLedgerOpen(false)}
        />
      )}

      {reviewOpen && session.lastHandReview !== null && (
        <HandReviewModal
          review={session.lastHandReview}
          seatProfiles={session.seatProfiles}
          terminology={lang}
          onPracticeSpot={onPracticeSpot}
          onNextHand={handleNextHand}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  );
}
