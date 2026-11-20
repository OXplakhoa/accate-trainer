import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addChips,
  chipValue,
  DENOMINATIONS,
  emptyChips,
  exchangeHandChips,
  getLegalActions,
  selectionMatches,
  subtractChips,
  type BettingAction,
  type ChipCounts,
  type Denomination,
  type HandState,
} from '../../engine';
import {
  buildDrillProgressReport,
  buildFixtureDrillSpot,
  createDrillSession,
  createDrillSpotFromHandState,
  createInitialDrillPersistedState,
  DRILL_CONCEPT_IDS,
  DRILL_CONCEPT_TITLES_VI,
  DRILL_LEVEL_TITLES_VI,
  DRILL_LEVELS,
  finalizeDrillSessionHand,
  findAvailableChipExchanges,
  generateDrillSpot,
  getVisibleFeedback,
  LEVEL1_STEP_ORDER,
  loadDrillStateFromStorage,
  markLessonCompleted,
  recordCompletedAttempt,
  requestDrillHint,
  resolveLevel3TimeoutAction,
  saveDrillStateToStorage,
  selectPhysicalChipsForAmount,
  submitLevel1Step,
  submitLevel2Decision,
  submitLevel3Decision,
  updateDrillPreferences,
  type ActiveDrillLevel,
  type BoardTextureClass,
  type ChipExchangeHelperOption,
  type DrillConceptId,
  type DrillFixtureId,
  type DrillLevel,
  type DrillPersistedState,
  type DrillSessionState,
  type DrillSpot,
  type Level1StepId,
} from '../../engine/drill';
import { readAttemptClock } from './clock';
import { LessonView } from './LessonView';
import { ProgressView } from './ProgressView';
import { DrillSoundController } from './sound';
import { DRILL_SCOPED_CSS } from './styles';
import { ChipToken, TableSnapshotView } from './VisualComponents';

export interface DrillAppProps {
  readonly initialSpot?: {
    readonly hand: HandState;
    readonly heroId: string;
  };
  readonly defaultLevel?: DrillLevel;
  readonly defaultConcept?: DrillConceptId;
  readonly defaultClockSeconds?: 10 | 15 | 20 | 25;
  readonly onBackToSandbox?: () => void;
}

const STEP_LABELS_VI: Readonly<Record<Level1StepId, string>> = Object.freeze({
  outs: '1. Đếm Outs',
  'unseen-cards': '2. Số lá chưa biết',
  'turn-percent': '3. % Turn (1 lá)',
  'river-percent': '4. % tới River',
  'pot-odds': '5. Pot Odds (%)',
  action: '6. Hành động & Chip',
});

const MILESTONE_OPTIONS: readonly {
  readonly value: 'generated' | DrillFixtureId;
  readonly labelVi: string;
}[] = Object.freeze([
  { value: 'generated', labelVi: '🎲 Sinh tình huống mới' },
  { value: 'h1-step7', labelVi: '📌 Đôi J ở Flop' },
  { value: 'h1-step13', labelVi: '📌 H1 #13 — Turn 5♠' },
  { value: 'h1-step16', labelVi: '📌 H1 #16 — River K♣' },
  { value: 'd8-chase-draw', labelVi: '📌 Quyết định ở Turn' },
  { value: 'dirty-outs-flop-oesd', labelVi: '📌 Tình huống ở Flop' },
  { value: 'clean-outs-turn-flush-draw', labelVi: '📌 Tình huống ở Turn' },
  { value: 'side-pot-multiway', labelVi: '📌 Tình huống Side Pot' },
  { value: 'nong-tilt-spot', labelVi: '📌 Tình huống với Nóng' },
  { value: 'board-texture-wet-checkraise', labelVi: '📌 Tình huống Check-Raise' },
]);

function getBrowserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
}

function safeNowMs(): number {
  try {
    return typeof performance !== 'undefined' ? performance.now() : 0;
  } catch {
    return 0;
  }
}

export function DrillApp(props: DrillAppProps) {
  const soundRef = useRef<DrillSoundController | null>(null);
  if (soundRef.current === null) {
    soundRef.current = new DrillSoundController();
  }

  // Load persisted state from browser storage with corruption & blocked-storage recovery
  const initialLoad = useMemo(() => loadDrillStateFromStorage(getBrowserLocalStorage), []);
  const [persistedState, setPersistedState] = useState<DrillPersistedState>(() => {
    let st = initialLoad.state;
    if (props.defaultLevel !== undefined) {
      st = updateDrillPreferences(st, { lastSelectedLevel: props.defaultLevel });
    }
    if (props.defaultConcept !== undefined) {
      st = updateDrillPreferences(st, { lastSelectedConcept: props.defaultConcept });
    }
    if (props.defaultClockSeconds !== undefined) {
      st = updateDrillPreferences(st, { clockSeconds: props.defaultClockSeconds });
    }
    return st;
  });

  const [storageAvailable, setStorageAvailable] = useState<boolean>(initialLoad.storageAvailable);
  const [storageWarningVi, setStorageWarningVi] = useState<string | null>(() => {
    if (!initialLoad.storageAvailable) {
      return 'Trình duyệt đang chặn localStorage; dữ liệu tiến bộ vẫn hoạt động trong phiên hiện tại.';
    }
    if (initialLoad.recoveredFromError) {
      return `Đã khôi phục dữ liệu tiến bộ an toàn (mã: ${initialLoad.errorReason ?? 'recovered'}).`;
    }
    return null;
  });

  const persistState = useCallback((next: DrillPersistedState) => {
    setPersistedState(next);
    const res = saveDrillStateToStorage(getBrowserLocalStorage, next);
    if (!res.ok) {
      setStorageAvailable(false);
      setStorageWarningVi(
        'Trình duyệt đang chặn ghi localStorage; tiến bộ vẫn hoạt động trong phiên hiện tại.',
      );
    }
  }, []);

  const [activeTab, setActiveTab] = useState<'drill' | 'progress'>('drill');
  const [selectedLevel, setSelectedLevel] = useState<DrillLevel>(() =>
    props.initialSpot !== undefined
      ? (props.defaultLevel !== undefined && props.defaultLevel !== 0
          ? props.defaultLevel
          : 1)
      : (props.defaultLevel ?? initialLoad.state.lastSelectedLevel),
  );
  const [selectedConcept, setSelectedConcept] = useState<DrillConceptId>(
    () => props.defaultConcept ?? initialLoad.state.lastSelectedConcept,
  );
  const [selectedSourceMode, setSelectedSourceMode] = useState<'generated' | DrillFixtureId>(
    'generated',
  );
  const [seedCounter, setSeedCounter] = useState<number>(1);
  const [muted, setMuted] = useState<boolean>(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);

  // Build initial spot (either from Sandbox `initialSpot` prop or canonical H1 #7 / concept spot)
  const [currentSpot, setCurrentSpot] = useState<DrillSpot>(() => {
    if (props.initialSpot !== undefined) {
      try { return createDrillSpotFromHandState({ hand: props.initialSpot.hand, heroId: props.initialSpot.heroId, conceptId: props.defaultConcept ?? 'ev-comparison' }); } catch { return buildFixtureDrillSpot('h1-step7'); }
    }
    return buildFixtureDrillSpot('h1-step7');
  });

  const activeLevelForSession: ActiveDrillLevel = selectedLevel === 0 ? 1 : selectedLevel;
  const [session, setSession] = useState<DrillSessionState>(() =>
    createDrillSession(currentSpot, activeLevelForSession),
  );

  // Physical chip selection state (Hero clicks individual chips from stack)
  const [selectedChips, setSelectedChips] = useState<ChipCounts>(() => emptyChips());
  const [chipHistory, setChipHistory] = useState<readonly Denomination[]>([]);
  const [showExchangeDrawer, setShowExchangeDrawer] = useState<boolean>(false);
  const [confirmingFreeFold, setConfirmingFreeFold] = useState<boolean>(false);
  const [actionErrorVi, setActionErrorVi] = useState<string | null>(null);

  // Form inputs for Level 1 & Level 2
  const [step1InputStr, setStep1InputStr] = useState<string>('');
  const [l2OutsStr, setL2OutsStr] = useState<string>('');
  const [l2TurnPctStr, setL2TurnPctStr] = useState<string>('');
  const [l2RiverPctStr, setL2RiverPctStr] = useState<string>('');
  const [l2PotOddsStr, setL2PotOddsStr] = useState<string>('');
  const [boardTextureChoice, setBoardTextureChoice] = useState<BoardTextureClass | ''>('');

  // UI-layer clock for tracking response time & Level 3 countdown
  const spotStartTimeRef = useRef<number>(safeNowMs());
  const attemptDurationRef = useRef(persistedState.clockSeconds);
  const submittedRef = useRef(false);
  const initialSpotRef = useRef(props.initialSpot);
  const [initialSpotError, setInitialSpotError] = useState(() => props.initialSpot !== undefined && (props.initialSpot.hand.phase !== 'betting' || props.initialSpot.hand.activePlayerId !== props.initialSpot.heroId || !props.initialSpot.hand.seats.some(s => s.playerId === props.initialSpot!.heroId && s.status === 'active')));
  const [remainingSeconds, setRemainingSeconds] = useState<number>(persistedState.clockSeconds);

  const resetInputsForSpot = useCallback(
    (spot: DrillSpot, lvl: ActiveDrillLevel) => {
      setSession(createDrillSession(spot, lvl));
      setSelectedChips(emptyChips());
      setChipHistory([]);
      setShowExchangeDrawer(false);
      setConfirmingFreeFold(false);
      setActionErrorVi(null);
      setStep1InputStr('');
      setL2OutsStr('');
      setL2TurnPctStr('');
      setL2RiverPctStr('');
      setL2PotOddsStr('');
      setBoardTextureChoice('');
      spotStartTimeRef.current = safeNowMs();
      attemptDurationRef.current = persistedState.clockSeconds;
      submittedRef.current = false;
      setRemainingSeconds(persistedState.clockSeconds);
    },
    [persistedState.clockSeconds],
  );

  useEffect(() => {
    if (props.initialSpot === initialSpotRef.current) return;
    initialSpotRef.current = props.initialSpot;
    if (props.initialSpot === undefined) return;
    try {
      const nextSpot = createDrillSpotFromHandState({ hand: props.initialSpot.hand, heroId: props.initialSpot.heroId, conceptId: selectedConcept });
      setInitialSpotError(false);
      setCurrentSpot(nextSpot);
      setActiveTab('drill');
      if (selectedLevel === 0) setSelectedLevel(1);
      resetInputsForSpot(nextSpot, selectedLevel === 0 ? 1 : selectedLevel);
    } catch { setInitialSpotError(true); }
  }, [props.initialSpot, resetInputsForSpot, selectedConcept, selectedLevel]);

  const loadNewSpot = useCallback(
    (
      mode: 'generated' | DrillFixtureId,
      concept: DrillConceptId,
      nextCounter: number,
      targetLevel: DrillLevel,
    ) => {
      const nextSpot =
        mode === 'generated'
          ? generateDrillSpot({
              seed: `drill-seed:${concept}:${nextCounter}`,
              conceptId: concept,
            })
          : buildFixtureDrillSpot(mode, undefined, concept);

      setInitialSpotError(false);
      setCurrentSpot(nextSpot);
      const activeLvl: ActiveDrillLevel = targetLevel === 0 ? 1 : targetLevel;
      resetInputsForSpot(nextSpot, activeLvl);
      soundRef.current?.play({ kind: 'card-flip' }, `spot-load:${nextSpot.spotId}:${nextCounter}`);
    },
    [resetInputsForSpot],
  );

  const handleSelectLevel = (lvl: DrillLevel) => {
    setSelectedLevel(lvl);
    persistState(updateDrillPreferences(persistedState, { lastSelectedLevel: lvl }));
    if (lvl !== 0) {
      resetInputsForSpot(currentSpot, lvl);
    }
  };

  const handleSelectConcept = (cid: DrillConceptId) => {
    setSelectedConcept(cid);
    persistState(updateDrillPreferences(persistedState, { lastSelectedConcept: cid }));
    if (selectedLevel !== 0) {
      const nextCount = seedCounter + 1;
      setSeedCounter(nextCount);
      loadNewSpot(selectedSourceMode, cid, nextCount, selectedLevel);
    }
  };

  const handleSelectMilestone = (val: 'generated' | DrillFixtureId) => {
    setSelectedSourceMode(val);
    const nextCount = seedCounter + 1;
    setSeedCounter(nextCount);
    loadNewSpot(val, selectedConcept, nextCount, selectedLevel);
  };

  const timerStateRef = useRef({ currentSpot, session, boardTextureChoice, persistedState });
  timerStateRef.current = { currentSpot, session, boardTextureChoice, persistedState };
  useEffect(() => {
    if (activeTab !== 'drill' || selectedLevel !== 3 || session.phase !== 'answering') return;
    const timerId = window.setInterval(() => {
      const { elapsedMs, remainingSeconds: leftSec } = readAttemptClock(spotStartTimeRef.current, attemptDurationRef.current, safeNowMs());
      setRemainingSeconds(leftSec);
      const latest = timerStateRef.current;
      if (leftSec > 0 && leftSec <= 3) soundRef.current?.play({ kind: 'tick' }, `tick:${latest.currentSpot.spotId}:${leftSec}`);
      if (leftSec === 0 && !submittedRef.current) {
        submittedRef.current = true;
        window.clearInterval(timerId);
        setSelectedChips(emptyChips());
        setChipHistory([]);
        const res = submitLevel3Decision(latest.session, {
          action: resolveLevel3TimeoutAction(latest.currentSpot), responseTimeMs: Math.round(elapsedMs), timedOut: true,
          ...(latest.boardTextureChoice !== '' ? { boardTexture: latest.boardTextureChoice } : {}),
          sequenceIndex: latest.persistedState.nextSequenceIndex, autoCompleteHand: true,
        });
        if (res.ok) {
          setSession(res.session);
          if (res.session.attemptRecord !== null) persistState(recordCompletedAttempt(latest.persistedState, res.session.attemptRecord));
        }
      }
    }, 250);
    return () => window.clearInterval(timerId);
  }, [activeTab, selectedLevel, session.phase, persistState]);

  const heroSeat = useMemo(
    () => currentSpot.handState.seats.find((s) => s.playerId === currentSpot.heroId)!,
    [currentSpot],
  );

  const availableHeroStack = useMemo(
    () => subtractChips(heroSeat.stack, selectedChips),
    [heroSeat.stack, selectedChips],
  );

  const selectedChipsTotal = useMemo(() => chipValue(selectedChips), [selectedChips]);

  const legalActions = useMemo(
    () => getLegalActions(currentSpot.handState),
    [currentSpot.handState],
  );

  const exchangeOptions = useMemo(
    () => findAvailableChipExchanges(currentSpot.handState, currentSpot.heroId),
    [currentSpot.handState, currentSpot.heroId],
  );

  const handleAddChip = (denom: Denomination) => {
    if (availableHeroStack[denom] < 1 || session.phase !== 'answering') {
      return;
    }
    const delta: ChipCounts = {
      5: denom === 5 ? 1 : 0,
      10: denom === 10 ? 1 : 0,
      50: denom === 50 ? 1 : 0,
      100: denom === 100 ? 1 : 0,
    };
    setSelectedChips((prev) => addChips(prev, delta));
    setChipHistory((prev) => [...prev, denom]);
    setActionErrorVi(null);
    soundRef.current?.play({ kind: 'chip', denomination: denom });
  };

  const handleUndoLastChip = () => {
    if (chipHistory.length === 0) {
      return;
    }
    const lastDenom = chipHistory[chipHistory.length - 1]!;
    if (selectedChips[lastDenom] < 1) {
      return;
    }
    const delta: ChipCounts = {
      5: lastDenom === 5 ? 1 : 0,
      10: lastDenom === 10 ? 1 : 0,
      50: lastDenom === 50 ? 1 : 0,
      100: lastDenom === 100 ? 1 : 0,
    };
    setSelectedChips((prev) => subtractChips(prev, delta));
    setChipHistory((prev) => prev.slice(0, -1));
    setActionErrorVi(null);
  };

  const handleClearChips = () => {
    setSelectedChips(emptyChips());
    setChipHistory([]);
    setActionErrorVi(null);
  };

  const handleAutoPickChips = (targetAmount: number) => {
    const picked = selectPhysicalChipsForAmount(heroSeat.stack, targetAmount);
    if (picked === null) {
      setActionErrorVi(
        `Stack hiện tại không đủ chip lẻ để ghép đúng ${targetAmount} điểm. Hãy bấm "Đổi chip" để đổi mệnh giá lớn lấy chip nhỏ!`,
      );
      setShowExchangeDrawer(true);
      return;
    }
    setSelectedChips(picked);
    const history: Denomination[] = [];
    for (const d of DENOMINATIONS) {
      for (let i = 0; i < picked[d]; i++) {
        history.push(d);
      }
    }
    setChipHistory(history);
    setActionErrorVi(null);
    soundRef.current?.play({ kind: 'chip', denomination: 10 });
  };

  const handleExecuteExchange = (opt: ChipExchangeHelperOption) => {
    const res = exchangeHandChips(currentSpot.handState, {
      fromPlayerId: currentSpot.heroId,
      target: opt.target,
      give: opt.give,
      receive: opt.receive,
    });
    if (!res.ok) {
      setActionErrorVi(`Không thể đổi chip: ${res.message}`);
      return;
    }
    const updatedSpot: DrillSpot = Object.freeze({
      ...currentSpot,
      handState: res.state,
    });
    setCurrentSpot(updatedSpot);
    setSession((prev) => Object.freeze({ ...prev, spot: updatedSpot }));
    setSelectedChips(emptyChips());
    setChipHistory([]);
    setShowExchangeDrawer(false);
    setActionErrorVi(null);
    soundRef.current?.play({ kind: 'chip', denomination: 5 });
  };

  const computeElapsedMs = (): number => {
    const now = safeNowMs();
    return Math.max(100, Math.round(now - spotStartTimeRef.current));
  };

  // Validate and construct BettingAction from user's physical chip selection
  const buildActionFromSelection = (
    kind: BettingAction['type'],
  ): { readonly ok: true; readonly action: BettingAction } | { readonly ok: false; readonly messageVi: string } => {
    if (legalActions === null) {
      return { ok: false, messageVi: 'Không ở trong vòng cược hợp lệ.' };
    }

    switch (kind) {
      case 'fold':
        return { ok: true, action: { type: 'fold' } };

      case 'check':
        if (!legalActions.canCheck) {
          return {
            ok: false,
            messageVi: `Không thể Check khi đang đối mặt mức cược ${legalActions.toCall} điểm.`,
          };
        }
        return { ok: true, action: { type: 'check' } };

      case 'call': {
        if (!legalActions.canCall || legalActions.callAmount === null) {
          return { ok: false, messageVi: 'Không có khoản cược nào cần Call.' };
        }
        if (!selectionMatches(selectedChips, legalActions.callAmount)) {
          return {
            ok: false,
            messageVi: `Cần chọn đúng ${legalActions.callAmount} điểm chip vật lý để Call (bạn đang chọn ${selectedChipsTotal} điểm).`,
          };
        }
        return { ok: true, action: { type: 'call', chips: selectedChips } };
      }

      case 'bet': {
        if (!legalActions.canBet || legalActions.betRange === null) {
          return { ok: false, messageVi: 'Không thể Bet khi đã có người mở cược trên street này.' };
        }
        const { min, max, step } = legalActions.betRange;
        if (
          selectedChipsTotal < min ||
          selectedChipsTotal > max ||
          selectedChipsTotal % step !== 0
        ) {
          return {
            ok: false,
            messageVi: `Khoản Bet phải là bội số của ${step} từ ${min} đến ${max} (bạn đang chọn ${selectedChipsTotal} điểm).`,
          };
        }
        return {
          ok: true,
          action: { type: 'bet', amount: selectedChipsTotal, chips: selectedChips },
        };
      }

      case 'raise': {
        if (!legalActions.canRaise || legalActions.raiseRange === null) {
          return {
            ok: false,
            messageVi: `Không thể Raise (mức cược hiện hành ${legalActions.currentBet} đã chạm cap ${legalActions.streetCap}).`,
          };
        }
        const raiseTo = legalActions.playerStreetContribution + selectedChipsTotal;
        const { min, max, step } = legalActions.raiseRange;
        if (raiseTo < min || raiseTo > max || raiseTo % step !== 0) {
          return {
            ok: false,
            messageVi: `Mức Raise lên phải là bội số của ${step} từ ${min} đến ${max} (tức bỏ thêm từ ${min - legalActions.playerStreetContribution} đến ${max - legalActions.playerStreetContribution}; bạn đang chọn thêm ${selectedChipsTotal} → tổng ${raiseTo}).`,
          };
        }
        return {
          ok: true,
          action: { type: 'raise', raiseTo, chips: selectedChips },
        };
      }
    }
  };

  // Level 1 numeric step submission (Steps 1..5)
  const handleSubmitLevel1Numeric = () => {
    if (session.currentStepId === 'action') {
      return;
    }
    const parsed = Number(step1InputStr.trim().replace(',', '.'));
    if (step1InputStr.trim() === '' || Number.isNaN(parsed)) {
      setActionErrorVi('Vui lòng nhập một con số hợp lệ cho bước này.');
      return;
    }
    const res = submitLevel1Step(session, {
      stepId: session.currentStepId,
      value: parsed,
    });
    if (!res.ok) {
      setActionErrorVi(res.message);
      return;
    }
    setSession(res.session);
    setActionErrorVi(null);
    setStep1InputStr('');
    soundRef.current?.play(
      { kind: res.evaluation.isCorrect ? 'correct' : 'incorrect' },
      `L1-step:${currentSpot.spotId}:${res.evaluation.stepId}:${parsed}`,
    );
  };

  // Action submission for Level 1 (Step 6), Level 2, or Level 3
  const handleConfirmAction = (kind: BettingAction['type']) => {
    // Ask confirmation if hero clicks Fold when Check is free (Spec §3.3)
    if (kind === 'fold' && legalActions?.canCheck && !confirmingFreeFold) {
      setConfirmingFreeFold(true);
      setActionErrorVi(
        'Bạn có thể Check miễn phí (0 điểm). Bấm "Fold" thêm một lần nữa nếu bạn thật sự muốn bỏ bài.',
      );
      return;
    }
    setConfirmingFreeFold(false);

    const built = buildActionFromSelection(kind);
    if (!built.ok) {
      setActionErrorVi(built.messageVi);
      soundRef.current?.play({ kind: 'incorrect' });
      return;
    }

    const elapsedMs = computeElapsedMs();

    if (selectedLevel !== 3 && currentSpot.snapshot.street !== 'preflop' && boardTextureChoice === '') {
      setActionErrorVi('Hãy chọn đặc điểm mặt bài trước khi chọn hành động.');
      return;
    }

    if (selectedLevel === 1) {
      const res = submitLevel1Step(session, {
        stepId: 'action',
        action: built.action,
        ...(boardTextureChoice !== '' ? { boardTexture: boardTextureChoice } : {}),
        responseTimeMs: elapsedMs,
        sequenceIndex: persistedState.nextSequenceIndex,
        autoCompleteHand: true,
      });
      if (!res.ok) {
        setActionErrorVi(res.message);
        return;
      }
      setSession(res.session);
      setActionErrorVi(null);
      if (res.session.attemptRecord !== null) {
        persistState(recordCompletedAttempt(persistedState, res.session.attemptRecord));
      }
      soundRef.current?.play(
        { kind: res.evaluation.isCorrect ? 'correct' : 'incorrect' },
        `L1-done:${currentSpot.spotId}`,
      );
      return;
    }

    if (selectedLevel === 2) {
      const hasDraw = currentSpot.snapshot.street === 'flop' || currentSpot.snapshot.street === 'turn';
      const isFlop = currentSpot.snapshot.street === 'flop';
      const parse = (value: string) => value.trim() === '' ? undefined : Number(value.trim().replace(',', '.'));
      const outsVal = parse(l2OutsStr);
      const turnPctVal = parse(l2TurnPctStr);
      const riverPctVal = parse(l2RiverPctStr);
      const potOddsVal = parse(l2PotOddsStr);
      if ((hasDraw && (outsVal === undefined || !Number.isFinite(outsVal) || turnPctVal === undefined || !Number.isFinite(turnPctVal))) ||
          (isFlop && (riverPctVal === undefined || !Number.isFinite(riverPctVal))) || potOddsVal === undefined || !Number.isFinite(potOddsVal)) {
        setActionErrorVi('Vui lòng nhập đầy đủ các số được yêu cầu trước khi xác nhận hành động.');
        return;
      }

      // First enter 'action-submitted' so ONLY the 1-line summary is shown (AC D2)
      const res = submitLevel2Decision(session, {
        ...(hasDraw && outsVal !== undefined ? { outs: outsVal } : {}),
        ...(turnPctVal !== undefined && !Number.isNaN(turnPctVal)
          ? { turnPercent: turnPctVal }
          : {}),
        ...(isFlop && riverPctVal !== undefined ? { riverPercent: riverPctVal } : {}),
        potOddsPercent: potOddsVal,
        ...(boardTextureChoice !== '' ? { boardTexture: boardTextureChoice } : {}),
        action: built.action,
        responseTimeMs: elapsedMs,
        sequenceIndex: persistedState.nextSequenceIndex,
        autoCompleteHand: false,
      });
      if (!res.ok) {
        setActionErrorVi(res.message);
        return;
      }
      setSession(res.session);
      setActionErrorVi(null);
      if (res.session.attemptRecord !== null) {
        persistState(recordCompletedAttempt(persistedState, res.session.attemptRecord));
      }
      soundRef.current?.play(
        { kind: res.session.postHandFeedback?.isDecisionCorrect ? 'correct' : 'incorrect' },
        `L2-act:${currentSpot.spotId}`,
      );
      return;
    }

    if (selectedLevel === 3) {
      if (submittedRef.current || elapsedMs >= attemptDurationRef.current * 1000) return;
      const res = submitLevel3Decision(session, {
        action: built.action,
        responseTimeMs: elapsedMs,
        timedOut: false,
        ...(boardTextureChoice !== '' ? { boardTexture: boardTextureChoice } : {}),
        sequenceIndex: persistedState.nextSequenceIndex,
        autoCompleteHand: true,
      });
      if (!res.ok) {
        setActionErrorVi(res.message);
        return;
      }
      submittedRef.current = true;
      setSession(res.session);
      setActionErrorVi(null);
      if (res.session.attemptRecord !== null) {
        persistState(recordCompletedAttempt(persistedState, res.session.attemptRecord));
      }
      soundRef.current?.play(
        { kind: res.session.postHandFeedback?.isDecisionCorrect ? 'correct' : 'incorrect' },
        `L3-done:${currentSpot.spotId}`,
      );
    }
  };

  const handleFinalizeLevel2Hand = () => {
    const res = finalizeDrillSessionHand(session);
    if (res.ok) {
      setSession(res.session);
      soundRef.current?.play({ kind: 'payout' }, `L2-fin:${currentSpot.spotId}`);
    }
  };

  const handleRequestHint = () => {
    const res = requestDrillHint(session);
    if (res.ok) {
      setSession(res.session);
    } else {
      setActionErrorVi(res.message);
    }
  };

  const visibleFeedback = useMemo(() => getVisibleFeedback(session), [session]);
  const progressReport = useMemo(
    () => buildDrillProgressReport(persistedState),
    [persistedState],
  );

  // Check button eligibility based on physical chips selected
  const isCallConfirmable =
    legalActions !== null &&
    legalActions.canCall &&
    legalActions.callAmount !== null &&
    selectionMatches(selectedChips, legalActions.callAmount);

  const isBetConfirmable =
    legalActions !== null &&
    legalActions.canBet &&
    legalActions.betRange !== null &&
    selectedChipsTotal >= legalActions.betRange.min &&
    selectedChipsTotal <= legalActions.betRange.max &&
    selectedChipsTotal % legalActions.betRange.step === 0;

  const targetRaiseTo =
    (legalActions?.playerStreetContribution ?? 0) + selectedChipsTotal;
  const isRaiseConfirmable =
    legalActions !== null &&
    legalActions.canRaise &&
    legalActions.raiseRange !== null &&
    selectedChipsTotal > 0 &&
    targetRaiseTo >= legalActions.raiseRange.min &&
    targetRaiseTo <= legalActions.raiseRange.max &&
    targetRaiseTo % legalActions.raiseRange.step === 0;

  const displayedHandState =
    session.phase === 'hand-completed' && session.postHandFeedback !== null
      ? session.postHandFeedback.completedHandState
      : session.phase === 'action-submitted' && session.stateAfterHeroAction !== null
        ? session.stateAfterHeroAction
        : currentSpot.handState;

  return (
    <div className={`accate-drill-root${reducedMotion ? ' drill-reduced-motion' : ''}`}>
      <style>{DRILL_SCOPED_CSS}</style>

      <div className="drill-shell">
        {initialSpotError ? <div role="alert" className="drill-banner drill-banner-warn">Không thể luyện tình huống này: cần đến lượt Hero trong vòng cược. Hãy chọn tình huống mới hoặc quay lại Sandbox.</div> : null}
        {/* Top Bar */}
        <header className="drill-topbar">
          <div className="drill-brand">
            <div>
              <h1 className="drill-brand-title">Accate Trainer — Bài tập</h1>
            </div>
          </div>

          <nav className="drill-nav-group" aria-label="Điều hướng chính trong Drill">
            <button
              type="button"
              className={`drill-btn${activeTab === 'drill' ? ' drill-btn-active' : ''}`}
              onClick={() => setActiveTab('drill')}
            >
              Bài tập
            </button>
            <button
              type="button"
              className={`drill-btn${activeTab === 'progress' ? ' drill-btn-active' : ''}`}
              onClick={() => setActiveTab('progress')}
            >
              Tiến bộ
            </button>
            <button
              type="button"
              className="drill-btn"
              aria-pressed={!muted}
              onClick={() => {
                const next = !muted;
                setMuted(next);
                soundRef.current?.setMuted(next);
              }}
            >
              {muted ? '🔇 Đang tắt âm' : '🔊 Âm thanh'}
            </button>
            <button
              type="button"
              className="drill-btn"
              aria-pressed={reducedMotion}
              onClick={() => setReducedMotion((v) => !v)}
            >
              {reducedMotion ? '🐢 Giảm motion: Bật' : '✨ Motion: Chuẩn'}
            </button>
            {props.onBackToSandbox !== undefined ? (
              <button
                type="button"
                className="drill-btn"
                onClick={props.onBackToSandbox}
              >
                ← Quay lại Bàn Sandbox
              </button>
            ) : null}
          </nav>
        </header>

        {/* Level-up suggestion banner when >= 80% over last 20 attempts (AC D7) */}
        {progressReport.overallLevelUpSuggestion.shouldSuggestLevelUp &&
        progressReport.overallLevelUpSuggestion.messageVi !== null ? (
          <div className="drill-banner drill-banner-good" role="status">
            <span>🏆 {progressReport.overallLevelUpSuggestion.messageVi}</span>
            {progressReport.overallLevelUpSuggestion.suggestedNextLevel !== null &&
            progressReport.overallLevelUpSuggestion.suggestedNextLevel !== selectedLevel ? (
              <button
                type="button"
                className="drill-btn drill-btn-primary"
                onClick={() => {
                  setActiveTab('drill');
                  handleSelectLevel(progressReport.overallLevelUpSuggestion.suggestedNextLevel!);
                }}
              >
                Thử sức ở Cấp {progressReport.overallLevelUpSuggestion.suggestedNextLevel} →
              </button>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'progress' ? (
          <ProgressView
            report={progressReport}
            storageAvailable={storageAvailable}
            storageWarningVi={storageWarningVi}
            onStartPractice={(lvl, cid) => {
              setActiveTab('drill');
              if (cid !== undefined) {
                setSelectedConcept(cid); setSelectedLevel(lvl); setSelectedSourceMode('generated');
                persistState(updateDrillPreferences(persistedState, { lastSelectedConcept: cid, lastSelectedLevel: lvl }));
                const nextCount = seedCounter + 1; setSeedCounter(nextCount);
                loadNewSpot('generated', cid, nextCount, lvl);
              } else { handleSelectLevel(lvl); }
            }}
            onResetProgress={() => {
              const clean = createInitialDrillPersistedState();
              persistState(clean);
            }}
          />
        ) : (
          <>
            {/* Free Level Selection Bar & Spot / Concept Selectors (AC D7) */}
            <section
              className="drill-controls-bar"
              aria-label="Chọn cấp độ tự do, khái niệm và tình huống"
            >
              <div className="drill-level-pills" role="group" aria-label="Chọn cấp độ (0 đến 3, không khóa)">
                {DRILL_LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    className={`drill-btn${selectedLevel === lvl ? ' drill-btn-active' : ''}`}
                    onClick={() => handleSelectLevel(lvl)}
                  >
                    {DRILL_LEVEL_TITLES_VI[lvl]}
                  </button>
                ))}
              </div>

              {selectedLevel !== 0 ? (
                <div className="drill-select-group">
                  <label htmlFor="drill-concept-select" className="drill-label">
                    Khái niệm:
                  </label>
                  <select
                    id="drill-concept-select"
                    className="drill-select"
                    value={selectedConcept}
                    onChange={(e) => handleSelectConcept(e.target.value as DrillConceptId)}
                  >
                    {DRILL_CONCEPT_IDS.map((cid) => (
                      <option key={cid} value={cid}>
                        {DRILL_CONCEPT_TITLES_VI[cid]}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="drill-milestone-select" className="drill-label">
                    Tình huống:
                  </label>
                  <select
                    id="drill-milestone-select"
                    className="drill-select"
                    value={selectedSourceMode}
                    onChange={(e) =>
                      handleSelectMilestone(e.target.value as 'generated' | DrillFixtureId)
                    }
                  >
                    {MILESTONE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.labelVi}
                      </option>
                    ))}
                  </select>

                  {selectedLevel === 3 ? (
                    <>
                      <label htmlFor="drill-clock-select" className="drill-label">
                        Đồng hồ:
                      </label>
                      <select
                        id="drill-clock-select"
                        className="drill-select"
                        value={persistedState.clockSeconds}
                        onChange={(e) => {
                          const sec = Number(e.target.value) as 10 | 15 | 20 | 25;
                          persistState(updateDrillPreferences(persistedState, { clockSeconds: sec }));
                        }}
                      >
                        {([10, 15, 20, 25] as const).map((s) => (
                          <option key={s} value={s}>
                            {s} giây
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}

                  <button
                    type="button"
                    className="drill-btn drill-btn-primary"
                    onClick={() => {
                      const nextCount = seedCounter + 1;
                      setSeedCounter(nextCount);
                      loadNewSpot(selectedSourceMode, selectedConcept, nextCount, selectedLevel);
                    }}
                  >
                    ↻ Ván / Spot mới
                  </button>
                </div>
              ) : null}
            </section>

            {/* Level 0 Lesson View OR Levels 1-3 Table & Solver Workspace */}
            {selectedLevel === 0 ? (
              <LessonView
                conceptId={selectedConcept}
                completedLessons={persistedState.completedLessons}
                onSelectConcept={(cid) => handleSelectConcept(cid)}
                onCompleteAndPractice={(cid) => {
                  const nextPersisted = updateDrillPreferences(
                    markLessonCompleted(persistedState, cid),
                    { lastSelectedLevel: 1, lastSelectedConcept: cid },
                  );
                  persistState(nextPersisted);
                  setSelectedConcept(cid);
                  setSelectedLevel(1);
                  const nextCount = seedCounter + 1;
                  setSeedCounter(nextCount);
                  loadNewSpot('generated', cid, nextCount, 1);
                }}
              />
            ) : (
              <div className="drill-workspace">
                {/* Left Column: Accate Felt Table & Hero Physical Chips */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <TableSnapshotView
                    spot={currentSpot}
                    currentHandState={displayedHandState}
                    showShowdownCards={session.phase === 'hand-completed'}
                    hidePrompt={session.phase !== 'hand-completed'}
                  />

                  <section className="drill-feedback-card" aria-label="Lịch sử hành động công khai">
                    <strong>Lịch sử hành động công khai</strong>
                    {currentSpot.publicTimeline.filter(e => e.type === 'player-action' || e.type === 'out-of-turn-declared' || e.type === 'out-of-turn-cancelled').map((e, i) => (
                      <div key={i}>{'street' in e ? e.street.toUpperCase() : ''} · {'playerId' in e ? e.playerId : ''} · {'action' in e ? e.action.type.toUpperCase() : ''}{e.type === 'out-of-turn-declared' ? ' (ngoài lượt)' : e.type === 'out-of-turn-cancelled' ? ' (hủy ngoài lượt)' : ''}{e.type === 'player-action' && e.addedAmount > 0 ? ` ${e.addedAmount}` : ''}</div>
                    ))}
                  </section>
                  {/* Physical Chip Selection Tray (Hero clicks individual chips, D19, C2, C3) */}
                  <section
                    className="drill-hero-zone"
                    aria-label="Khay chọn chip vật lý của Hero (4 mệnh giá 5, 10, 50, 100)"
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <div>
                        <strong style={{ color: 'var(--drill-accent)' }}>
                          Khay bấm Chip vật lý (Mệnh giá 5 · 10 · 50 · 100)
                        </strong>
                        <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
                          Bấm từng chip từ stack để tạo khoản cược hợp lệ · Đang chọn:{' '}
                          <strong style={{ color: 'var(--drill-accent)', fontSize: '0.95rem' }}>
                            {selectedChipsTotal} điểm
                          </strong>
                          {legalActions?.callAmount ? (
                            <span> (Cần Call: {legalActions.callAmount} điểm)</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="drill-nav-group">
                        {legalActions?.canCall && legalActions.callAmount !== null ? (
                          <button
                            type="button"
                            className="drill-btn"
                            disabled={session.phase !== 'answering'}
                            onClick={() => handleAutoPickChips(legalActions.callAmount!)}
                          >
                            ⚡ Ghép chip Call ({legalActions.callAmount})
                          </button>
                        ) : null}
                        {legalActions?.canBet && legalActions.betRange !== null ? (
                          <button
                            type="button"
                            className="drill-btn"
                            disabled={session.phase !== 'answering'}
                            onClick={() => handleAutoPickChips(legalActions.betRange!.max)}
                          >
                            ⚡ Ghép chip Cap ({legalActions.betRange.max})
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="drill-btn"
                          disabled={chipHistory.length === 0 || session.phase !== 'answering'}
                          onClick={handleUndoLastChip}
                        >
                          ↩ Bỏ chip vừa chọn
                        </button>
                        <button
                          type="button"
                          className="drill-btn"
                          disabled={selectedChipsTotal === 0 || session.phase !== 'answering'}
                          onClick={handleClearChips}
                        >
                          ✕ Xoá chọn
                        </button>
                        <button
                          type="button"
                          className="drill-btn"
                          disabled={session.phase !== 'answering'}
                          onClick={() => setShowExchangeDrawer((v) => !v)}
                        >
                          🔄 Đổi chip ({exchangeOptions.length})
                        </button>
                      </div>
                    </div>

                    {/* 4 Physical Denominations to Click */}
                    <div className="drill-chip-rack">
                      {DENOMINATIONS.map((denom) => {
                        const avail = availableHeroStack[denom];
                        const chosen = selectedChips[denom];
                        return (
                          <button
                            key={denom}
                            type="button"
                            className="drill-chip-btn"
                            disabled={avail < 1 || session.phase !== 'answering'}
                            onClick={() => handleAddChip(denom)}
                            aria-label={`Bấm thêm 1 chip mệnh giá ${denom} (còn ${avail} trong stack, đã chọn ${chosen})`}
                          >
                            <ChipToken denomination={denom} size={32} />
                            <div style={{ textAlign: 'left' }}>
                              <div>+{denom} điểm</div>
                              <div style={{ fontSize: '0.73rem', color: 'var(--drill-text-muted)' }}>
                                Còn: {avail} {chosen > 0 ? `· Chọn: ${chosen}` : ''}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Equal-Value Chip Exchange Drawer (AC C3, D20, D21) */}
                    {showExchangeDrawer ? (
                      <div
                        className="drill-feedback-card"
                        role="region"
                        aria-label="Đổi chip lớn lấy chip nhỏ với Pot hoặc người chơi khác"
                      >
                        <div style={{ fontWeight: 700, color: 'var(--drill-accent)' }}>
                          Đổi chip mệnh giá lớn lấy chip nhỏ (giữ nguyên tổng giá trị & INV-1):
                        </div>
                        {exchangeOptions.length === 0 ? (
                          <div style={{ fontSize: '0.82rem', color: 'var(--drill-text-muted)' }}>
                            Hiện không có phép đổi chip lớn nào khả dụng từ stack của bạn.
                          </div>
                        ) : (
                          <div className="drill-nav-group">
                            {exchangeOptions.map((opt, idx) => (
                              <button
                                key={idx}
                                type="button"
                                className="drill-btn"
                                onClick={() => handleExecuteExchange(opt)}
                              >
                                {opt.labelVi}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </section>
                </div>

                {/* Right Column: Level 1 / Level 2 / Level 3 Question, Action Controls & Feedback */}
                <aside className="drill-action-panel" aria-label="Bảng câu hỏi, hành động và lời giải Drill">
                  {/* Level header & Level 3 Timer */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <div>
                      <h3 style={{ margin: 0, color: 'var(--drill-accent)', fontSize: '1.05rem' }}>
                        {DRILL_LEVEL_TITLES_VI[selectedLevel]}
                      </h3>
                      <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
                        {selectedLevel === 1
                          ? 'Trả lời từng bước theo thứ tự · Hint miễn phí · Feedback ngay sau mỗi bước'
                          : selectedLevel === 2
                            ? 'Nhập đầy đủ trong một lượt · Có hint (ghi vào chỉ số) · 1 dòng sau action, phân tích đủ sau ván'
                            : 'Quyết định dưới áp lực đồng hồ · Không có hint · Feedback chỉ hiện sau khi kết thúc ván'}
                      </div>
                    </div>

                    {selectedLevel !== 3 && session.phase === 'answering' ? (
                      <button
                        type="button"
                        className="drill-btn"
                        onClick={handleRequestHint}
                      >
                        💡 {selectedLevel === 1 ? 'Gợi ý miễn phí' : 'Xem gợi ý (ghi chỉ số)'}
                      </button>
                    ) : null}
                  </div>

                  {/* Level 3 Countdown Clock */}
                  {selectedLevel === 3 ? (
                    <div
                      className={`drill-timer-box${remainingSeconds <= 3 && session.phase === 'answering' ? ' drill-timer-urgent' : ''}`}
                      role="timer"
                      aria-live="polite"
                    >
                      <span>
                        ⏱ Đồng hồ Cấp 3 (hết giờ tự {legalActions?.canCheck ? 'Check' : 'Fold'}):
                      </span>
                      <strong style={{ fontSize: '1.15rem' }}>
                        {session.phase === 'answering'
                          ? `${remainingSeconds} giây`
                          : session.timedOut
                            ? 'Hết giờ (Auto)'
                            : `Đã chốt (${((session.responseTimeMs ?? 0) / 1000).toFixed(1).replace('.', ',')}s)`}
                      </strong>
                    </div>
                  ) : null}

                  {/* Active Hint Banner (Levels 1 & 2 only) */}
                  {session.lastHintVi !== null && selectedLevel !== 3 ? (
                    <div className="drill-banner drill-banner-warn" role="status">
                      <span>💡 {session.lastHintVi}</span>
                    </div>
                  ) : null}

                  {/* Validation / Action Error Banner */}
                  {actionErrorVi !== null ? (
                    <div className="drill-banner drill-banner-bad" role="alert">
                      <span>⚠️ {actionErrorVi}</span>
                    </div>
                  ) : null}

                  {/* LEVEL 1: D1 Step-by-Step Flow */}
                  {selectedLevel === 1 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div className="drill-step-track" role="list" aria-label="Tiến trình 6 bước">
                        {LEVEL1_STEP_ORDER.map((stepId, idx) => {
                          const evalItem = session.stepFeedbacks[stepId];
                          const isCurrent =
                            session.phase === 'answering' && session.currentStepIndex === idx;
                          const pillClass = [
                            'drill-step-pill',
                            isCurrent ? 'drill-step-pill-current' : '',
                            evalItem !== undefined
                              ? evalItem.isCorrect
                                ? 'drill-step-pill-done-ok'
                                : 'drill-step-pill-done-err'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ');
                          return (
                            <span key={stepId} className={pillClass} role="listitem">
                              {STEP_LABELS_VI[stepId]}
                              {evalItem !== undefined ? (evalItem.isCorrect ? ' ✓' : ' ✗') : ''}
                            </span>
                          );
                        })}
                      </div>

                      {session.phase === 'answering' && session.currentStepId !== 'action' ? (
                        <div className="drill-feedback-card">
                          <label htmlFor="drill-l1-step-input" style={{ fontWeight: 700, color: 'var(--drill-accent)' }}>
                            {session.currentStepId === 'outs'
                              ? `Bước 1 — Đếm Outs: ${(currentSpot.fixtureId === 'dirty-outs-flop-oesd' ? 'Có bao nhiêu clean outs thắng sạch trước range của Đá?' : currentSpot.outsQuestionPromptVi)}`
                              : session.currentStepId === 'unseen-cards'
                                ? 'Bước 2 — Số lá chưa biết trong bộ bài hiện tại là bao nhiêu?'
                                : session.currentStepId === 'turn-percent'
                                  ? 'Bước 3 — Xác suất trúng ở 1 lá tiếp theo (Turn) là bao nhiêu %?'
                                  : session.currentStepId === 'river-percent'
                                    ? 'Bước 4 — Xác suất trúng tới River là bao nhiêu %? (Có thể nhập chính xác hoặc Rule of 4)'
                                    : `Bước 5 — Pot Odds (Equity cần để Call ${currentSpot.snapshot.callAmount} vào pot ${currentSpot.snapshot.potBeforeCall}) là bao nhiêu %?`}
                          </label>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input
                              id="drill-l1-step-input"
                              type="number"
                              step="any"
                              min="0"
                              max="100"
                              className="drill-input"
                              style={{ flex: 1 }}
                              placeholder={
                                session.currentStepId === 'outs'
                                  ? 'Nhập số nguyên'
                                  : session.currentStepId === 'unseen-cards'
                                    ? 'Nhập số lá (vd: 47 hoặc 46)'
                                    : 'Nhập % (vd: 8.42 hoặc 30)'
                              }
                              value={step1InputStr}
                              onChange={(e) => setStep1InputStr(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSubmitLevel1Numeric();
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="drill-btn drill-btn-primary"
                              onClick={handleSubmitLevel1Numeric}
                            >
                              Kiểm tra bước {session.currentStepIndex + 1} →
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {/* Immediate Per-Step Feedback List for Level 1 */}
                      {Object.keys(visibleFeedback.stepFeedbacks).length > 0 ? (
                        <div
                          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                          aria-label="Phản hồi từng bước Cấp 1"
                        >
                          {LEVEL1_STEP_ORDER.map((stepId) => {
                            const ev = visibleFeedback.stepFeedbacks[stepId];
                            if (ev === undefined) {
                              return null;
                            }
                            return (
                              <div
                                key={stepId}
                                className={`drill-banner ${ev.isCorrect ? 'drill-banner-good' : 'drill-banner-bad'}`}
                                role="status"
                              >
                                <div>
                                  <strong>{ev.isCorrect ? '✓' : '✗'}</strong> {ev.feedbackVi}{' '}
                                  <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>
                                    ({ev.lectureRef})
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* LEVEL 2: One-Shot Input Grid */}
                  {selectedLevel === 2 && session.phase === 'answering' ? (
                    <div className="drill-feedback-card" aria-label="Biểu mẫu tự giải một lượt Cấp 2">
                      <div style={{ fontWeight: 700, color: 'var(--drill-accent)' }}>
                        Nhập thông số tự giải (một lượt) rồi chọn chip & hành động:
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--drill-text-muted)' }}>
                        Câu hỏi Outs: {(currentSpot.fixtureId === 'dirty-outs-flop-oesd' ? 'Có bao nhiêu clean outs thắng sạch trước range của Đá?' : currentSpot.outsQuestionPromptVi)}
                      </div>
                      <div className="drill-field-grid">
                        {(currentSpot.snapshot.street === 'flop' || currentSpot.snapshot.street === 'turn') ? <><div className="drill-field">
                          <label htmlFor="l2-outs" className="drill-label">
                            Số Outs (lá)
                          </label>
                          <input
                            id="l2-outs"
                            type="number"
                            min="0"
                            max="52"
                            className="drill-input"
                            value={l2OutsStr}
                            onChange={(e) => setL2OutsStr(e.target.value)}
                          />
                        </div>
                        <div className="drill-field">
                          <label htmlFor="l2-turn-pct" className="drill-label">
                            % Trúng 1 lá ({currentSpot.snapshot.street === 'turn' ? 'River' : 'Turn'})
                          </label>
                          <input
                            id="l2-turn-pct"
                            type="number"
                            step="any"
                            min="0"
                            max="100"
                            className="drill-input"
                            value={l2TurnPctStr}
                            onChange={(e) => setL2TurnPctStr(e.target.value)}
                          />
                        </div>
                        </> : null}
                        {currentSpot.snapshot.street === 'flop' ? <div className="drill-field">
                          <label htmlFor="l2-river-pct" className="drill-label">
                            % Trúng tới River
                          </label>
                          <input
                            id="l2-river-pct"
                            type="number"
                            step="any"
                            min="0"
                            max="100"
                            className="drill-input"
                            value={l2RiverPctStr}
                            onChange={(e) => setL2RiverPctStr(e.target.value)}
                          />
                        </div>
                        : null}
                        <div className="drill-field">
                          <label htmlFor="l2-pot-odds" className="drill-label">
                            Pot Odds / Equity cần (%)
                          </label>
                          <input
                            id="l2-pot-odds"
                            type="number"
                            step="any"
                            min="0"
                            max="100"
                            className="drill-input"
                            value={l2PotOddsStr}
                            onChange={(e) => setL2PotOddsStr(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Board Texture Quick Classifier (available when answering action) */}
                  {session.phase === 'answering' &&
                  (selectedLevel !== 1 || session.currentStepId === 'action') ? (
                    <div className="drill-feedback-card">
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                        }}
                      >
                        {currentSpot.snapshot.street !== 'preflop' ? <><label htmlFor="drill-board-texture-select" className="drill-label">
                          Đọc đặc điểm mặt bài:
                        </label>
                        <select
                          id="drill-board-texture-select"
                          className="drill-select"
                          value={boardTextureChoice}
                          onChange={(e) =>
                            setBoardTextureChoice(e.target.value as BoardTextureClass | '')
                          }
                        >
                          <option value="">Chọn đặc điểm mặt bài</option>
                          <option value="dry">Dry (Mặt bài khô)</option>
                          <option value="wet">Wet (Mặt bài ướt)</option>
                          <option value="draw-heavy">Nhiều draw (Draw-heavy)</option>
                        </select></> : null}
                      </div>

                      {/* Legal Action Buttons (Enforcing engine legalActions & physical chip matching!) */}
                      <div style={{ fontWeight: 700, color: 'var(--drill-accent)', marginTop: 4 }}>
                        Chọn hành động hợp lệ (đã chọn {selectedChipsTotal} điểm chip vật lý):
                      </div>
                      <div className="drill-nav-group" role="group" aria-label="Các nút hành động cược hợp lệ">
                        {/* FOLD */}
                        <button
                          type="button"
                          className="drill-btn drill-btn-danger"
                          disabled={!(legalActions?.canFold ?? false)}
                          onClick={() => handleConfirmAction('fold')}
                        >
                          Fold
                        </button>

                        {/* CHECK: Strictly omitted when facing a bet (AC H1 #7, R5: Không có nút Check) */}
                        {legalActions?.canCheck ? (
                          <button
                            type="button"
                            className="drill-btn drill-btn-primary"
                            onClick={() => handleConfirmAction('check')}
                          >
                            Check (0)
                          </button>
                        ) : null}

                        {/* CALL: Locked until selected physical chips match callAmount (AC C2) */}
                        {legalActions?.canCall && legalActions.callAmount !== null ? (
                          <button
                            type="button"
                            className="drill-btn drill-btn-primary"
                            disabled={!isCallConfirmable}
                            onClick={() => handleConfirmAction('call')}
                            title={
                              isCallConfirmable
                                ? `Xác nhận Call ${legalActions.callAmount}`
                                : `Hãy chọn đúng ${legalActions.callAmount} điểm chip vật lý để mở khóa nút Call`
                            }
                          >
                            {legalActions.isCallAllIn
                              ? `Call All-in ${legalActions.callAmount}`
                              : `Call ${legalActions.callAmount}`}
                            {!isCallConfirmable ? ` (đang chọn ${selectedChipsTotal})` : ' ✓'}
                          </button>
                        ) : null}

                        {/* BET: Shown when currentBet === 0 */}
                        {legalActions?.canBet && legalActions.betRange !== null ? (
                          <button
                            type="button"
                            className="drill-btn drill-btn-primary"
                            disabled={!isBetConfirmable}
                            onClick={() => handleConfirmAction('bet')}
                          >
                            Bet {isBetConfirmable ? selectedChipsTotal : `${legalActions.betRange.min}…${legalActions.betRange.max}`}
                          </button>
                        ) : null}

                        {/* RAISE: Shown when facing a bet; disabled when currentBet === streetCap (AC H1 #13) */}
                        {(legalActions?.toCall ?? 0) > 0 ? (
                          <button
                            type="button"
                            className="drill-btn"
                            disabled={!isRaiseConfirmable}
                            onClick={() => handleConfirmAction('raise')}
                          >
                            {legalActions?.canRaise && legalActions.raiseRange !== null
                              ? isRaiseConfirmable
                                ? `Raise lên ${targetRaiseTo} (+${selectedChipsTotal})`
                                : `Raise lên ${legalActions.raiseRange.min}…${legalActions.raiseRange.max} (+chip)`
                              : `Raise (Đã chạm cap ${legalActions?.streetCap ?? 50})`}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {/* LEVEL 2 Immediate 1-Line Feedback right after action, BEFORE hand finishes (AC D2) */}
                  {visibleFeedback.kind === 'one-line' ? (
                    <div
                      className="drill-feedback-card"
                      role="status"
                      aria-label="Phản hồi một dòng ngay sau hành động Cấp 2"
                    >
                      <div className="drill-banner drill-banner-good">
                        <span>📌 {visibleFeedback.summaryLineVi}</span>
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--drill-text-muted)' }}>
                        (Cấp 2 chỉ hiện 1 dòng tóm tắt ngay sau khi chọn hành động. Bấm nút bên dưới để
                        lật nốt ván bài và xem toàn bộ phân tích sau ván.)
                      </div>
                      <button
                        type="button"
                        className="drill-btn drill-btn-primary"
                        onClick={handleFinalizeLevel2Hand}
                      >
                        Lật nốt ván & Xem phân tích đầy đủ sau ván →
                      </button>
                    </div>
                  ) : null}

                  {/* Full Post-Hand Analysis (After hand completes in Level 1, 2, or 3) */}
                  {visibleFeedback.kind === 'full-post-hand' &&
                  visibleFeedback.fullAnalysis !== null ? (
                    <div
                      className="drill-feedback-card"
                      role="region"
                      aria-label="Phân tích đầy đủ sau ván"
                    >
                      <div
                        className={`drill-banner ${
                          visibleFeedback.fullAnalysis.isDecisionCorrect
                            ? 'drill-banner-good'
                            : 'drill-banner-bad'
                        }`}
                      >
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '0.98rem' }}>
                            🏷 {visibleFeedback.fullAnalysis.decisionVsOutcomeBadgeVi} (
                            {visibleFeedback.fullAnalysis.streetDecisionBadgeVi})
                          </div>
                          <div style={{ marginTop: 2 }}>
                            {visibleFeedback.fullAnalysis.oneLineSummaryVi}
                          </div>
                          <div style={{ fontSize: '0.78rem', marginTop: 2, opacity: 0.9 }}>
                            ⚖️ {visibleFeedback.fullAnalysis.independenceReminderVi}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div>
                          <strong>• Lá cải thiện:</strong>{' '}
                          {visibleFeedback.fullAnalysis.breakdownVi.improvingCardsLineVi}
                        </div>
                        <div>
                          <strong>• Outs (Clean / Mixed-Dirty / Chop):</strong>{' '}
                          {visibleFeedback.fullAnalysis.breakdownVi.outsLineVi}
                        </div>
                        <div>
                          <strong>• % Trúng 1 lá & 2 lá (vs Rule of 2/4):</strong>{' '}
                          {visibleFeedback.fullAnalysis.breakdownVi.hitProbabilitiesLineVi}
                        </div>
                        <div>
                          <strong>• Pot Odds:</strong>{' '}
                          {visibleFeedback.fullAnalysis.breakdownVi.potOddsLineVi}
                        </div>
                        <div>
                          <strong>• Equity trước Range Rival:</strong>{' '}
                          {visibleFeedback.fullAnalysis.breakdownVi.equityVsRangeLineVi}
                        </div>
                        <div>
                          <strong>• EV Quyết định & Spot rõ (&gt; 5%):</strong>{' '}
                          {visibleFeedback.fullAnalysis.breakdownVi.evAndClearSpotLineVi}
                        </div>
                        <div>
                          <strong>• Board Texture & Đại diện bài:</strong>{' '}
                          {visibleFeedback.fullAnalysis.breakdownVi.boardTextureLineVi}
                        </div>
                        <div>
                          <strong>• Bet Sizing (Luật vs Chiến thuật & Đuổi Draw):</strong>{' '}
                          {visibleFeedback.fullAnalysis.breakdownVi.sizingLineVi}
                        </div>
                        <div>
                          <strong>• Kết quả ván bài:</strong>{' '}
                          {visibleFeedback.fullAnalysis.breakdownVi.outcomeLineVi}
                        </div>
                      </div>

                      <details style={{ marginTop: 4 }}>
                        <summary style={{ cursor: 'pointer', color: 'var(--drill-accent)', fontWeight: 700 }}>
                          Chi tiết giả định trong lời giải (Range, Số đối thủ, Stack, Pot, Vị trí, Cap)
                        </summary>
                        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '0.81rem' }}>
                          {visibleFeedback.fullAnalysis.breakdownVi.assumptionsLinesVi.map(
                            (line, i) => (
                              <li key={i}>{line}</li>
                            ),
                          )}
                        </ul>
                      </details>

                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                          marginTop: 6,
                        }}
                      >
                        <span className="drill-badge">
                          📖 Nguồn bài giảng: {currentSpot.solution.lectureRef}
                        </span>
                        <div className="drill-nav-group">
                          <button
                            type="button"
                            className="drill-btn"
                            onClick={() => setActiveTab('progress')}
                          >
                            📊 Xem 8 Chỉ số Tiến bộ
                          </button>
                          <button
                            type="button"
                            className="drill-btn drill-btn-primary"
                            onClick={() => {
                              const nextCount = seedCounter + 1;
                              setSeedCounter(nextCount);
                              loadNewSpot(
                                selectedSourceMode,
                                selectedConcept,
                                nextCount,
                                selectedLevel,
                              );
                            }}
                          >
                            Spot kế tiếp →
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </aside>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default DrillApp;
