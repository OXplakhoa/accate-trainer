import type {
  BetOrRaiseEvResult,
  CallEvResult,
  CheckEvResult,
  ClearSpotClassification,
  ClearSpotDecisionEvaluation,
  DecisionSnapshot,
  EquityResult,
  FoldEvResult,
  HandImprovementAnalysis,
  MultiPotCallEvResult,
  OutsCountMetric,
  PercentagePointErrorMetric,
  PotOddsResult,
  RangeOutsAnalysis,
} from '../calculator';
import type { Card } from '../cards';
import type { ChipCounts } from '../chips';
import type { BettingAction, HandErrorCode, HandState, Street } from '../handTypes';
import type {
  NongTiltState,
  PublicTimelineEvent,
  RivalId,
  RivalRangeEstimate,
  RivalSeatMetadata,
} from '../rivals';
import type { TieBreakMode } from '../showdown';

export const DRILL_LEVELS = [0, 1, 2, 3] as const;
export type DrillLevel = (typeof DRILL_LEVELS)[number];
export type ActiveDrillLevel = Exclude<DrillLevel, 0>;

export const DRILL_CONCEPT_IDS = [
  'outs',
  'hit-percent',
  'pot-odds',
  'ev-comparison',
  'rival-range',
  'board-texture',
  'bet-sizing',
] as const;

export type DrillConceptId = (typeof DRILL_CONCEPT_IDS)[number];

export const LEVEL1_STEP_ORDER = [
  'outs',
  'unseen-cards',
  'turn-percent',
  'river-percent',
  'pot-odds',
  'action',
] as const;

export type Level1StepId = (typeof LEVEL1_STEP_ORDER)[number];

export type BoardTextureClass = 'dry' | 'wet' | 'draw-heavy';

export type DrillOutsQuestionKind = 'improvement-outs' | 'clean-outs-vs-range';

export const DRILL_FIXTURE_IDS = [
  'h1-step7',
  'h1-step13',
  'h1-step16',
  'd8-chase-draw',
  'dirty-outs-flop-oesd',
  'clean-outs-turn-flush-draw',
  'side-pot-multiway',
  'nong-tilt-spot',
  'board-texture-wet-checkraise',
] as const;

export type DrillFixtureId = (typeof DRILL_FIXTURE_IDS)[number];

export interface BoardTextureAnalysis {
  readonly classification: BoardTextureClass;
  readonly labelVi: string;
  readonly paired: boolean;
  readonly maxSuitCount: number;
  readonly connectivityScore: number;
  readonly flushDrawPossible: boolean;
  readonly straightDrawPossible: boolean;
  readonly explanationVi: string;
  readonly rivalRepresentationVi: Readonly<Record<RivalId, string>>;
}

export interface DrawChaseCapAnalysis {
  readonly potBeforeHeroBet: number;
  readonly maxHeroBetOrRaiseTo: number;
  readonly maxHeroAddedAmount: number;
  readonly potSeenByOpponent: number;
  readonly opponentCallAmount: number;
  readonly opponentPotAfterCall: number;
  readonly opponentPotToCallLabel: string;
  readonly opponentRequiredEquity: number;
  readonly opponentRequiredEquityPercent: number;
  readonly flushDrawOuts: number;
  readonly flushDrawUnseenCards: number;
  readonly flushDrawExactEquity: number;
  readonly flushDrawExactEquityPercent: number;
  readonly canPriceOutFlushDrawWithCap: boolean;
  readonly explanationVi: string;
  readonly lectureContrastRef: string;
}

export interface DrillSizingAnalysis {
  readonly street: Street;
  readonly streetCap: number;
  readonly currentBet: number;
  readonly heroStreetContribution: number;
  readonly remainingCapAllowance: number;
  readonly heroStack: number;
  readonly canBet: boolean;
  readonly legalBetAmounts: readonly number[];
  readonly canRaise: boolean;
  readonly legalRaiseToAmounts: readonly number[];
  readonly recommendedSizingTarget: number | null;
  readonly legalSizingVi: string;
  readonly tacticalSizingVi: string;
  readonly drawChaseAnalysis: DrawChaseCapAnalysis;
}

export interface PotSliceEquityBreakdown {
  readonly potId: string;
  readonly labelVi: string;
  readonly potBeforeCall: number;
  readonly heroAddedAmount: number;
  readonly potAfterCall: number;
  readonly heroEligible: boolean;
  readonly eligibleOpponentIds: readonly string[];
  readonly heroEquity: number | null;
  readonly expectedReturn: number;
}

export interface DrillActionEvOption {
  readonly actionType: BettingAction['type'];
  readonly amount: number;
  readonly labelVi: string;
  readonly ev: number;
  readonly precision: 'exact' | 'estimated';
  readonly detailVi: string;
}

export interface DrillActionEvSummary {
  readonly foldEv: FoldEvResult;
  readonly callEv: CallEvResult | null;
  readonly multiPotCallEv: MultiPotCallEvResult | null;
  readonly checkEv: CheckEvResult | null;
  readonly aggressiveEvs: readonly BetOrRaiseEvResult[];
  readonly options: readonly DrillActionEvOption[];
  readonly bestOption: DrillActionEvOption;
  readonly recommendedActions: readonly BettingAction['type'][];
  readonly explanationVi: string;
}

export interface DrillSolutionAssumptions {
  readonly street: Street;
  readonly streetCap: number;
  readonly potBeforeAction: number;
  readonly callAmount: number;
  readonly heroStack: number;
  readonly opponentStacks: Readonly<Record<string, number>>;
  readonly opponentCount: number;
  readonly contestingRivalIds: readonly RivalId[];
  readonly positionLabelVi: string;
  readonly openerPlayerId: string;
  readonly playersToActBeforeHero: readonly string[];
  readonly playersToActAfterHero: readonly string[];
  readonly rivalRanges: readonly {
    readonly playerId: string;
    readonly rivalId: RivalId;
    readonly name: string;
    readonly styleLabel: string;
    readonly isTilted: boolean;
    readonly publicActionVi: string;
    readonly comboCount: number;
    readonly totalWeight: number;
    readonly descriptionVi: string;
  }[];
  readonly notesVi: readonly string[];
}

export interface DrillSpotSolution {
  readonly conceptId: DrillConceptId;
  readonly outsQuestionKind: DrillOutsQuestionKind;
  readonly expectedOuts: number;
  readonly expectedOutsCards: readonly Card[];
  readonly expectedOutsLabelVi: string;
  readonly expectedOutsExplanationVi: string;
  readonly cleanOutCards: readonly Card[];
  readonly mixedOutCards: readonly Card[];
  readonly chopOutCards: readonly Card[];
  readonly improvementOnlyCards: readonly Card[];
  readonly unseenCards: number;
  readonly cardsRemainingToRiver: 0 | 1 | 2;
  readonly nextCardExactProbability: number;
  readonly nextCardExactPercent: number;
  readonly toRiverExactProbability: number;
  readonly toRiverExactPercent: number;
  readonly ruleOf2Percent: number | null;
  readonly ruleOf4Percent: number | null;
  readonly ruleOf4AdjustedPercent: number | null;
  readonly improvementVsWinEquityNoteVi: string;
  readonly improvementAnalysis: HandImprovementAnalysis | null;
  readonly rangeOutsAnalysis: RangeOutsAnalysis | null;
  readonly potOdds: PotOddsResult;
  readonly contestingRanges: readonly RivalRangeEstimate[];
  readonly perPotEquity: readonly PotSliceEquityBreakdown[];
  readonly effectiveEquity: number;
  readonly effectiveEquityPercent: number;
  readonly equityResult: EquityResult;
  readonly clearSpot: ClearSpotClassification;
  readonly actionEvs: DrillActionEvSummary;
  readonly boardTexture: BoardTextureAnalysis;
  readonly sizingAnalysis: DrillSizingAnalysis;
  readonly assumptions: DrillSolutionAssumptions;
  readonly lectureRef: string;
  readonly stepHintsVi: Readonly<Record<Level1StepId, string>>;
}

export interface DrillSpot {
  readonly spotId: string;
  readonly seed: string;
  readonly conceptId: DrillConceptId;
  readonly source: 'generated' | 'fixture' | 'sandbox';
  readonly fixtureId?: DrillFixtureId;
  readonly titleVi: string;
  readonly promptVi: string;
  readonly outsQuestionPromptVi: string;
  readonly handState: HandState;
  readonly heroId: string;
  readonly rivalSeats: Readonly<Record<string, RivalSeatMetadata>>;
  readonly seatRivalIds: Readonly<Record<string, RivalId>>;
  readonly nongTiltState: NongTiltState;
  readonly primaryRivalId: RivalId;
  readonly primaryRivalPlayerId: string;
  readonly contestingRivalIds: readonly RivalId[];
  readonly snapshot: DecisionSnapshot;
  readonly publicTimeline: readonly PublicTimelineEvent[];
  readonly solution: DrillSpotSolution;
}

export interface GenerateDrillSpotInput {
  readonly seed: string;
  readonly conceptId?: DrillConceptId;
  readonly playerCount?: number;
  readonly enabledRivalIds?: readonly RivalId[];
  readonly enablePreflopBetting?: boolean;
  readonly preflopCap?: number;
  readonly allowOutOfTurn?: boolean;
  readonly tieBreakMode?: TieBreakMode;
  readonly nongTiltState?: NongTiltState;
  readonly maxAttempts?: number;
  readonly forceFixtureId?: DrillFixtureId;
  readonly equitySamples?: number;
}

export interface Level1StepEvaluation {
  readonly stepId: Level1StepId;
  readonly isCorrect: boolean;
  readonly userInputDisplay: string;
  readonly expectedDisplay: string;
  readonly feedbackVi: string;
  readonly lectureRef: string;
  readonly outsMetric?: OutsCountMetric;
  readonly percentMetric?: PercentagePointErrorMetric;
  readonly potOddsMetric?: PercentagePointErrorMetric;
}

export interface DrillPostHandFeedback {
  readonly completedHandState: HandState;
  readonly heroAction: BettingAction;
  readonly heroActionLabelVi: string;
  readonly chosenActionEv: number;
  readonly bestActionEv: number;
  readonly evLoss: number;
  readonly isDecisionCorrect: boolean;
  readonly isGoodDecision: boolean;
  readonly heroWonHand: boolean;
  readonly heroPayout: number;
  readonly heroFinalContribution: number;
  readonly heroNetChipDelta: number;
  readonly winnerIds: readonly string[];
  readonly decisionVsOutcomeBadgeVi: string;
  readonly streetDecisionBadgeVi: string;
  readonly independenceReminderVi: string;
  readonly oneLineSummaryVi: string;
  readonly breakdownVi: {
    readonly improvingCardsLineVi: string;
    readonly outsLineVi: string;
    readonly hitProbabilitiesLineVi: string;
    readonly equityVsRangeLineVi: string;
    readonly potOddsLineVi: string;
    readonly evAndClearSpotLineVi: string;
    readonly boardTextureLineVi: string;
    readonly sizingLineVi: string;
    readonly assumptionsLinesVi: readonly string[];
    readonly outcomeLineVi: string;
  };
}

export type DrillVisibleFeedback =
  | {
      readonly kind: 'none';
      readonly stepFeedbacks: Readonly<Partial<Record<Level1StepId, Level1StepEvaluation>>>;
      readonly summaryLineVi: null;
      readonly fullAnalysis: null;
    }
  | {
      readonly kind: 'step-by-step';
      readonly stepFeedbacks: Readonly<Partial<Record<Level1StepId, Level1StepEvaluation>>>;
      readonly summaryLineVi: string | null;
      readonly fullAnalysis: DrillPostHandFeedback | null;
    }
  | {
      readonly kind: 'one-line';
      readonly stepFeedbacks: Readonly<Partial<Record<Level1StepId, Level1StepEvaluation>>>;
      readonly summaryLineVi: string;
      readonly fullAnalysis: null;
    }
  | {
      readonly kind: 'full-post-hand';
      readonly stepFeedbacks: Readonly<Partial<Record<Level1StepId, Level1StepEvaluation>>>;
      readonly summaryLineVi: string;
      readonly fullAnalysis: DrillPostHandFeedback;
    };

export interface DrillAttemptRecord {
  readonly attemptId: string;
  readonly sequenceIndex: number;
  readonly recordedAtIso?: string;
  readonly spotId: string;
  readonly conceptId: DrillConceptId;
  readonly level: ActiveDrillLevel;
  readonly street: Street;
  readonly primaryRivalId: RivalId;
  readonly contestingRivalIds: readonly RivalId[];
  readonly isNongTilted: boolean;
  readonly actionTaken: BettingAction['type'];
  readonly actionAmount: number;
  readonly recommendedAction: BettingAction['type'];
  readonly isDecisionCorrect: boolean;
  readonly evLoss: number;
  readonly chosenActionEv: number;
  readonly bestActionEv: number;
  readonly responseTimeMs: number | null;
  readonly timedOut: boolean;
  readonly hintUsed: boolean;
  readonly outsMetric: OutsCountMetric | null;
  readonly outsPercentMetric: PercentagePointErrorMetric | null;
  readonly potOddsMetric: PercentagePointErrorMetric | null;
  readonly clearSpotMetric: Omit<ClearSpotDecisionEvaluation, 'heroDecision'> & { readonly heroDecision: 'call' | 'fold' | null };
  readonly boardTextureMetric: {
    readonly userClassification: BoardTextureClass;
    readonly expectedClassification: BoardTextureClass;
    readonly isCorrect: boolean;
  } | null;
  readonly handWon: boolean;
  readonly decisionVsOutcomeBadgeVi: string;
}

export interface DrillSessionInputs {
  readonly outs?: number;
  readonly unseenCards?: number;
  readonly turnPercent?: number;
  readonly riverPercent?: number;
  readonly potOddsPercent?: number;
  readonly boardTexture?: BoardTextureClass;
}

export interface DrillSessionState {
  readonly level: ActiveDrillLevel;
  readonly spot: DrillSpot;
  readonly phase: 'answering' | 'action-submitted' | 'hand-completed';
  readonly currentStepIndex: number;
  readonly currentStepId: Level1StepId;
  readonly stepFeedbacks: Readonly<Partial<Record<Level1StepId, Level1StepEvaluation>>>;
  readonly inputs: DrillSessionInputs;
  readonly hintUsed: boolean;
  readonly hintsRequestedCount: number;
  readonly lastHintVi: string | null;
  readonly submittedAction: BettingAction | null;
  readonly stateAfterHeroAction: HandState | null;
  readonly responseTimeMs: number | null;
  readonly timedOut: boolean;
  readonly oneLineFeedbackVi: string | null;
  readonly postHandFeedback: DrillPostHandFeedback | null;
  readonly attemptRecord: DrillAttemptRecord | null;
}

export type DrillSessionErrorCode =
  | HandErrorCode
  | 'invalid-step-order'
  | 'invalid-numeric-input'
  | 'missing-required-inputs'
  | 'hints-disabled-in-level-3'
  | 'already-submitted'
  | 'action-not-submitted';

export interface RivalMetricSummary {
  readonly rivalId: RivalId;
  readonly name: string;
  readonly styleLabel: string;
  readonly measuredCount: number;
  readonly correctDecisions: number;
  readonly accuracyPercent: number | null;
  readonly clearSpotCount: number;
  readonly clearSpotCorrectCount: number;
  readonly clearSpotAccuracyPercent: number | null;
  readonly meanEvLoss: number | null;
  readonly wrongCallCount: number;
  readonly wrongFoldCount: number;
  readonly tiltedEncounterCount: number;
  readonly insightVi: string;
}

export interface DrillMetricsSummary {
  /** #1: Đếm outs đúng (target >= 90%, Hopkins L2 slide 24–27) */
  readonly outsAccuracy: {
    readonly measuredCount: number;
    readonly correctCount: number;
    readonly accuracyRatio: number | null;
    readonly accuracyPercent: number | null;
    readonly meanAbsoluteError: number | null;
    readonly targetPercent: number;
    readonly meetsTarget: boolean | null;
    readonly sourceRef: string;
  };
  /** #2: Sai số outs -> % (target <= 3 pp, L7 slide 6) */
  readonly outsPercentError: {
    readonly measuredCount: number;
    readonly withinTargetCount: number;
    readonly meanAbsoluteErrorPp: number | null;
    readonly maxAbsoluteErrorPp: number | null;
    readonly targetPp: number;
    readonly meetsTarget: boolean | null;
    readonly sourceRef: string;
  };
  /** #3: Sai số pot odds (target <= 3 pp, L2 slide 12–13; L7 slide 7–9) */
  readonly potOddsError: {
    readonly measuredCount: number;
    readonly withinTargetCount: number;
    readonly meanAbsoluteErrorPp: number | null;
    readonly maxAbsoluteErrorPp: number | null;
    readonly targetPp: number;
    readonly meetsTarget: boolean | null;
    readonly sourceRef: string;
  };
  /** #4: Quyết định đúng ở spot rõ (> 5 pp strict threshold, target >= 90%, L2 slide 10–11) */
  readonly clearSpotAccuracy: {
    readonly measuredCount: number;
    readonly excludedMarginalCount: number;
    readonly correctCount: number;
    readonly accuracyRatio: number | null;
    readonly accuracyPercent: number | null;
    readonly thresholdPp: number;
    readonly targetPercent: number;
    readonly meetsTarget: boolean | null;
    readonly sourceRef: string;
  };
  /** #5: EV mất / quyết định (chip, giảm dần, L2 slide 8) */
  readonly evLossPerDecision: {
    readonly measuredCount: number;
    readonly meanEvLoss: number | null;
    readonly totalEvLoss: number;
    readonly recentMeanEvLoss: number | null;
    readonly earlierMeanEvLoss: number | null;
    readonly isDecreasingTrend: boolean | null;
    readonly sourceRef: string;
  };
  /** #6: Tốc độ trung vị câu đúng (< đồng hồ đã chọn, L7 slide 5) */
  readonly medianSpeedCorrect: {
    readonly measuredCount: number;
    readonly medianMs: number | null;
    readonly medianSeconds: number | null;
    readonly targetClockSeconds: number;
    readonly meetsTarget: boolean | null;
    readonly sourceRef: string;
  };
  /** #7: Đọc board texture (target >= 85%, L5 slide 23–24; L8 slide 18) */
  readonly boardTextureAccuracy: {
    readonly measuredCount: number;
    readonly correctCount: number;
    readonly accuracyRatio: number | null;
    readonly accuracyPercent: number | null;
    readonly targetPercent: number;
    readonly meetsTarget: boolean | null;
    readonly sourceRef: string;
  };
  /** #8: Đọc theo kiểu rival (theo dõi riêng từng rival, L5 slide 25, 41, 65) */
  readonly byRival: Readonly<Record<RivalId, RivalMetricSummary>>;
}

export interface LevelUpSuggestion {
  readonly currentLevel: DrillLevel;
  readonly windowSize: number;
  readonly recentAttemptCount: number;
  readonly recentCorrectCount: number;
  readonly recentAccuracyRatio: number | null;
  readonly recentAccuracyPercent: number | null;
  readonly thresholdPercent: number;
  readonly shouldSuggestLevelUp: boolean;
  readonly suggestedNextLevel: ActiveDrillLevel | null;
  readonly messageVi: string | null;
}

export interface DrillTimeTrendPoint {
  readonly attemptIndex: number;
  readonly sequenceIndex: number;
  readonly labelVi: string;
  readonly conceptId: DrillConceptId;
  readonly level: ActiveDrillLevel;
  readonly primaryRivalId: RivalId;
  readonly isDecisionCorrect: boolean;
  readonly rollingAccuracyPercent: number;
  readonly evLoss: number;
  readonly rollingMeanEvLoss: number;
  readonly outsError: number | null;
  readonly potOddsErrorPp: number | null;
  readonly responseTimeMs: number | null;
}

export interface DrillConceptProgress {
  readonly conceptId: DrillConceptId;
  readonly titleVi: string;
  readonly lessonCompleted: boolean;
  readonly measuredCount: number;
  readonly correctDecisions: number;
  readonly accuracyPercent: number | null;
  readonly meanEvLoss: number | null;
  readonly outsAccuracyPercent: number | null;
  readonly potOddsMeanErrorPp: number | null;
}

export interface DrillLevelProgress {
  readonly level: ActiveDrillLevel;
  readonly titleVi: string;
  readonly measuredCount: number;
  readonly correctDecisions: number;
  readonly accuracyPercent: number | null;
  readonly meanEvLoss: number | null;
  readonly hintUsedCount: number;
  readonly medianCorrectTimeMs: number | null;
  readonly levelUpSuggestion: LevelUpSuggestion;
}

export interface DrillProgressReport {
  readonly isEmpty: boolean;
  readonly totalAttempts: number;
  readonly completedLessons: readonly DrillConceptId[];
  readonly metrics: DrillMetricsSummary;
  readonly byTime: readonly DrillTimeTrendPoint[];
  readonly byConcept: Readonly<Record<DrillConceptId, DrillConceptProgress>>;
  readonly byLevel: Readonly<Record<ActiveDrillLevel, DrillLevelProgress>>;
  readonly byRival: Readonly<Record<RivalId, RivalMetricSummary>>;
  readonly overallLevelUpSuggestion: LevelUpSuggestion;
}

export interface DrillPersistedState {
  readonly version: 1;
  readonly nextSequenceIndex: number;
  readonly completedLessons: readonly DrillConceptId[];
  readonly attempts: readonly DrillAttemptRecord[];
  readonly lastSelectedLevel: DrillLevel;
  readonly lastSelectedConcept: DrillConceptId;
  readonly clockSeconds: 10 | 15 | 20 | 25;
}

export interface DrillLessonMiniCheck {
  readonly questionVi: string;
  readonly optionsVi: readonly string[];
  readonly correctIndex: number;
  readonly explanationVi: string;
}

export interface DrillLessonExample {
  readonly titleVi: string;
  readonly setupVi: string;
  readonly heroCards: readonly [Card, Card];
  readonly board: readonly Card[];
  readonly potBeforeCall: number;
  readonly callAmount: number;
  readonly streetCap: number;
  readonly rivalId: RivalId;
  readonly calculationStepsVi: readonly string[];
  readonly takeawayVi: string;
}

export interface DrillLesson {
  readonly conceptId: DrillConceptId;
  readonly orderIndex: number;
  readonly titleVi: string;
  readonly subtitleVi: string;
  readonly estimatedMinutes: 2 | 3;
  readonly lectureRefs: readonly string[];
  readonly sections: readonly {
    readonly headingVi: string;
    readonly paragraphsVi: readonly string[];
  }[];
  readonly accateExample: DrillLessonExample;
  readonly miniCheck: DrillLessonMiniCheck;
}

export type ChipExchangeHelperOption = {
  readonly labelVi: string;
  readonly give: ChipCounts;
  readonly receive: ChipCounts;
  readonly target: { readonly kind: 'pot' } | { readonly kind: 'player'; readonly playerId: string };
};
