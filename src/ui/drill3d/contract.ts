import type { ChipCounts } from '../../engine';
import type { PublicTableSeat, TableSeatId } from '../sandbox/types';

export type ScenePhase = 'arrival' | 'decision' | 'review';
export type LessonHighlight = 'outs' | 'pot' | 'call' | 'total' | null;

export type SceneRival = 'ca' | 'cao' | 'nong';

export interface LiveSceneDetails {
  readonly potChips: ChipCounts;
  readonly handNumber: number;
  readonly timelineLength: number;
  readonly seats: readonly PublicTableSeat[];
  readonly payoutTransfers: readonly { readonly seatId: TableSeatId; readonly chips: ChipCounts }[];
  readonly street: 'preflop' | 'flop' | 'turn' | 'river' | null;
  readonly occupiedRivals: readonly SceneRival[];
  readonly activeRival: SceneRival | null;
  readonly activePlayerName: string | null;
}

export interface SceneTableSnapshot {
  readonly pot: number;
  readonly call: number;
  readonly heroCards: readonly string[];
  readonly board: readonly string[];
  readonly live?: LiveSceneDetails;
}

export interface DemoSpot extends SceneTableSnapshot {
  readonly outs: number;
  readonly heroCards: readonly [string, string];
  readonly board: readonly [string, string, string, string];
}

export const DEMO_SPOT: DemoSpot = {
  pot: 150,
  call: 50,
  outs: 9,
  heroCards: ['A♥', 'J♥'],
  board: ['K♥', '8♥', '5♣', '2♠'],
};

export interface DrillSceneProps {
  readonly phase: ScenePhase;
  readonly highlight: LessonHighlight;
  readonly spot: SceneTableSnapshot;
  readonly reducedMotion: boolean;
}

export type DrillCue = 'deal' | 'chip' | 'fold' | 'correct' | 'incorrect' | 'tick' | 'expired';

export interface DrillLessonProps {
  readonly spot: DemoSpot;
  readonly onPhaseChange: (phase: ScenePhase) => void;
  readonly onHighlightChange: (highlight: LessonHighlight) => void;
  readonly onCue?: (cue: DrillCue) => void;
}
