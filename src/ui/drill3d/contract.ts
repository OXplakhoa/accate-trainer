export type ScenePhase = 'arrival' | 'decision' | 'review';
export type LessonHighlight = 'outs' | 'pot' | 'call' | 'total' | null;

export interface DemoSpot {
  readonly pot: number;
  readonly call: number;
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
  readonly spot: DemoSpot;
  readonly reducedMotion: boolean;
}

export type DrillCue = 'deal' | 'chip' | 'fold' | 'correct' | 'incorrect' | 'tick' | 'expired';

export interface DrillLessonProps {
  readonly spot: DemoSpot;
  readonly onPhaseChange: (phase: ScenePhase) => void;
  readonly onHighlightChange: (highlight: LessonHighlight) => void;
  readonly onCue?: (cue: DrillCue) => void;
}
