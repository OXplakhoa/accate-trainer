import type {
  LessonHighlight,
  LiveSceneDetails,
  SceneRival,
  SceneTableSnapshot,
} from '../contract';

export const ALL_SCENE_RIVALS: readonly SceneRival[] = ['ca', 'cao', 'nong'];

export const RIVAL_LABELS_VI: Record<SceneRival, string> = {
  ca: 'Cá',
  cao: 'Cáo',
  nong: 'Nóng',
};

export const LIVE_STREET_LABELS_VI: Record<NonNullable<LiveSceneDetails['street']>, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
};

export function isLiveSnapshot(spot: SceneTableSnapshot): boolean {
  return spot.live !== undefined;
}

export function getOccupiedRivals(spot: SceneTableSnapshot): readonly SceneRival[] {
  return spot.live ? spot.live.occupiedRivals : ALL_SCENE_RIVALS;
}

export function getLiveStreetLabel(street: LiveSceneDetails['street']): string {
  return street ? LIVE_STREET_LABELS_VI[street] : 'Chờ ván mới';
}

export function getEffectiveHighlight(
  spot: SceneTableSnapshot,
  highlight: LessonHighlight,
): LessonHighlight {
  if (spot.live && highlight === 'outs') {
    return null;
  }
  return highlight;
}

export function shouldShowOuts(spot: SceneTableSnapshot, highlight: LessonHighlight): boolean {
  return !spot.live && highlight === 'outs';
}

export function shouldShowRiverPlaceholder(spot: SceneTableSnapshot): boolean {
  if (spot.board.length >= 5) {
    return false;
  }
  if (!spot.live) {
    return true;
  }
  return spot.board.length === 4 && spot.live.street === 'turn';
}

export function isRivalCardsVisible(spot: SceneTableSnapshot, rival: SceneRival): boolean {
  if (!spot.live) {
    return true;
  }
  return spot.live.street !== null && spot.live.occupiedRivals.includes(rival);
}
