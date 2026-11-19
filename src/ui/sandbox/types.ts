import type { ReactNode } from 'react';
import type {
  BettingAction,
  ChipCounts,
  DecisionSnapshot,
  Denomination,
  HandState,
  HandTimelineEvent,
  LedgerEvent,
  LegalActions,
  NongTiltState,
  OutOfTurnDeclaration,
  PotOddsResult,
  RivalId,
  ShowdownResolution,
  Street,
  TableBoundaryState,
  TieBreakMode,
} from '../../engine';

export const HERO_PLAYER_ID = 'hero' as const;

export type TerminologyLanguage = 'en-standard' | 'vi-bilingual';

export type TournamentTimerSeconds = 10 | 15 | 20 | 25;

export interface AudioSettings {
  readonly muted: boolean;
  readonly music: number;
  readonly chips: number;
  readonly cards: number;
  readonly timer: number;
}

export interface SandboxSettings {
  readonly playerCount: number;
  readonly enabledRivalIds: readonly RivalId[];
  readonly enablePreflopBetting: boolean;
  readonly preflopCap: number;
  readonly tieBreakMode: TieBreakMode;
  readonly allowOutOfTurn: boolean;
  readonly tournamentTimerSeconds: TournamentTimerSeconds;
  readonly reducedMotion: boolean;
  readonly audio: AudioSettings;
  readonly terminology: TerminologyLanguage;
  readonly pauseOnImportantSpot: boolean;
  readonly botSpeedMs: number;
}

export interface SeatProfileInfo {
  readonly playerId: string;
  readonly displayName: string;
  readonly rivalId: RivalId | null;
}

export interface PendingHeroOutOfTurnDecision {
  readonly declaration: OutOfTurnDeclaration;
  readonly snapshot: DecisionSnapshot;
  readonly handStateAtDecision: HandState;
  readonly potOdds: PotOddsResult;
  readonly activeOpponentIds: readonly string[];
  readonly timelineLengthAtDecision: number;
}

export interface HeroDecisionRecord {
  readonly decisionIndex: number;
  readonly street: Street;
  readonly snapshot: DecisionSnapshot;
  readonly handStateAtDecision: HandState;
  readonly chosenAction: BettingAction;
  readonly fromOutOfTurn: boolean;
  readonly potOdds: PotOddsResult;
  readonly activeOpponentIds: readonly string[];
  readonly timelineLengthAtDecision: number;
}

export type DecisionQualityTone = 'good' | 'marginal' | 'suboptimal' | 'mistake';

export interface HeroDecisionReview {
  readonly record: HeroDecisionRecord;
  readonly estimatedEquity: number | null;
  readonly equitySamples: number;
  readonly equitySeed: string;
  readonly chosenActionLabel: string;
  readonly turnLabelVi: string;
  readonly chosenEv: number;
  readonly chosenEvPrecision: 'exact' | 'estimated';
  readonly bestAlternativeLabel: string;
  readonly bestAlternativeEv: number;
  readonly evDiff: number;
  readonly qualityLabel: string;
  readonly qualityTone: DecisionQualityTone;
  readonly explanationVi: string;
  readonly assumptionsVi: readonly string[];
  readonly rangeSummariesVi: readonly string[];
}

export interface HandReviewSummary {
  readonly handNumber: number;
  readonly outcomeKind: 'fold-win' | 'showdown';
  readonly heroNetDelta: number;
  readonly heroPayout: number;
  readonly heroInvested: number;
  readonly outcomeBannerVi: string;
  readonly decisions: readonly HeroDecisionReview[];
  readonly timeline: readonly HandTimelineEvent[];
  readonly showdownResolution: ShowdownResolution | null;
  readonly foldWinnerId: string | null;
  readonly foldWinPotAmount: number;
}

export interface StatusNotice {
  readonly tone: 'info' | 'warning' | 'error' | 'success';
  readonly message: string;
  readonly guidance?: string;
}

export interface SandboxSessionState {
  readonly sessionSeed: string;
  readonly handNumber: number;
  readonly phase: 'in-hand' | 'between-hands';
  readonly appliedSettings: SandboxSettings;
  readonly pendingSettings: SandboxSettings | null;
  readonly hand: HandState | null;
  readonly boundary: TableBoundaryState | null;
  readonly ledgerEvents: readonly LedgerEvent[];
  readonly nongTiltState: NongTiltState;
  readonly nongTiltStateAtHandStart: NongTiltState;
  readonly seatProfiles: Readonly<Record<string, SeatProfileInfo>>;
  readonly stagedChips: ChipCounts;
  readonly stagedHistory: readonly Denomination[];
  readonly pendingHeroLeave: boolean;
  readonly pendingHeroOutOfTurnDecision: PendingHeroOutOfTurnDecision | null;
  readonly heroDecisionsCurrentHand: readonly HeroDecisionRecord[];
  readonly lastHandReview: HandReviewSummary | null;
  readonly stepCounter: number;
  readonly inviteCounter: number;
  readonly ootContextKey: string | null;
  readonly ootEvaluatedPlayers: readonly string[];
  readonly statusNotice: StatusNotice | null;
}

export interface HeroActionValidation {
  readonly isHeroTurn: boolean;
  readonly canDeclareOutOfTurn: boolean;
  readonly hasBindingDeclaration: boolean;
  readonly stagedValue: number;
  readonly legalActions: LegalActions | null;
  readonly canFold: boolean;
  readonly foldNeedsConfirm: boolean;
  readonly canCheck: boolean;
  readonly canConfirmCall: boolean;
  readonly callAmount: number | null;
  readonly isCallAllIn: boolean;
  readonly canConfirmBet: boolean;
  readonly betAmount: number | null;
  readonly canConfirmRaise: boolean;
  readonly raiseToAmount: number | null;
  readonly raiseAddedAmount: number | null;
  readonly validationHintVi: string | null;
}

export interface DealAnimationEndInfo {
  readonly handNumber: number;
  readonly street: Street;
  readonly eventCount: number;
}

export interface HeroTurnChangeInfo {
  readonly active: boolean;
  readonly hand: HandState | null;
  readonly legalActions: LegalActions | null;
  readonly hadCancelledDeclaration: boolean;
}

export interface SandboxExternalApi {
  readonly autoTimeoutHeroAction: () => void;
  readonly getState: () => SandboxSessionState;
}

export interface SandboxAppProps {
  /** Optional deterministic seed for tests or Tournament wrapper. */
  readonly initialSeed?: string;
  /** Optional initial settings override (merged & sanitized with persisted settings). */
  readonly initialSettings?: Partial<SandboxSettings>;
  /** Optional callback exposed for Control to jump into Drill mode on a spot. */
  readonly onPracticeSpot?: (hand: HandState, heroId: string) => void;
  /** Optional mode selector so P5 Tournament can reuse this table flow without rewriting it. */
  readonly mode?: 'sandbox' | 'tournament';
  /** Dedicated visible slot in the action area for P5 Tournament countdown timer. */
  readonly timerSlot?: ReactNode;
  /** Observable callback fired when deal/reveal animation finishes (O3 readiness). */
  readonly onDealAnimationEnd?: (info: DealAnimationEndInfo) => void;
  /** Observable callback fired whenever Hero's active turn state changes. */
  readonly onHeroTurnChange?: (info: HeroTurnChangeInfo) => void;
  /** Exposes timeout action (check if legal, else fold + return staged chips) for P5 Tournament. */
  readonly onControllerReady?: (api: SandboxExternalApi) => void;
  /** Suppresses mid-hand hints/feedback when running under Tournament rules (O6). */
  readonly disableMidHandFeedback?: boolean;
  /** Optional storage override for testing persistence/fallback. */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}
