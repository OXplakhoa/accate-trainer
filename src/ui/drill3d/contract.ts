export type ScenePhase = 'arrival' | 'decision' | 'review';
export type LessonHighlight = 'outs' | 'pot' | 'call' | 'total' | null;

export interface DemoSpot {
  readonly id: 'clear' | 'close';
  readonly pot: number;
  readonly call: number;
  readonly outs: number;
  readonly heroCards: readonly [string, string];
  readonly board: readonly [string, string, string, string];
}

export const DEMO_SPOTS: readonly [DemoSpot, DemoSpot] = [
  {
    id: 'clear',
    pot: 150,
    call: 50,
    outs: 9,
    heroCards: ['A♥', 'J♥'],
    board: ['K♥', '8♥', '5♣', '2♠'],
  },
  {
    id: 'close',
    pot: 160,
    call: 40,
    outs: 9,
    heroCards: ['A♥', 'J♥'],
    board: ['K♥', '8♥', '5♣', '2♠'],
  },
];

export interface DrillSceneProps {
  readonly phase: ScenePhase;
  readonly highlight: LessonHighlight;
  readonly spot: DemoSpot;
  readonly reducedMotion: boolean;
}

export interface DrillLessonProps {
  readonly spot: DemoSpot;
  readonly onSpotChange: (spot: DemoSpot) => void;
  readonly onPhaseChange: (phase: ScenePhase) => void;
  readonly onHighlightChange: (highlight: LessonHighlight) => void;
}
