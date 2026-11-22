import * as THREE from 'three';
import { DENOMINATIONS, type ChipCounts } from '../../../engine';
import type { PublicTableSeat, TableSeatId } from '../../sandbox/types';
import type { LessonHighlight, SceneRival, SceneTableSnapshot } from '../contract';
import { createActionBubbleTexture, formatSeatActionBubble } from './actionBubble';
import {
  buildChipStacks,
  CHIP_DENOMS,
  CHIP_RADIUS,
  chipsForAmount,
  countTotalChips,
  getUnseenHearts,
  layoutChipColumns,
  parseCard,
} from './outs';
import { createMatteMaterial, disposeObject3DResources, SCENE_COLORS } from './palette';
import {
  ALL_SCENE_RIVALS,
  getEffectiveHighlight,
  getOccupiedRivals,
  isLiveSnapshot,
  isRivalCardsVisible,
  shouldShowOuts,
  shouldShowRiverPlaceholder,
} from './snapshot';
import { getPlanDurationMs, type TableAnimation } from './tableMotion';
import {
  createCardBackTexture,
  createCardFaceTexture,
  createChipEdgeTexture,
  createChipTopTexture,
  createRiverSlotTexture,
} from './textures';

export interface TabletopRig {
  readonly root: THREE.Group;
  readonly updateSpot: (spot: SceneTableSnapshot) => void;
  readonly updateHighlight: (highlight: LessonHighlight) => void;
  readonly playAnimations?: (animations: readonly TableAnimation[], nowMs: number) => void;
  readonly stepAnimations?: (nowMs: number) => boolean;
  readonly snapAnimations?: () => void;
  readonly hasActiveAnimations?: () => boolean;
}

export interface ChipPileOptions {
  readonly maxPerColumn?: number;
  readonly scale?: number;
}

const CARD_W = 0.31;
const CARD_H = 0.43;
const CARD_THICK = 0.008;
const CHIP_HEIGHT = 0.022;

// Enlarged and slightly angled community cards for crisp index-corner legibility at 1440x900 and 390x844
const BOARD_CARD_SCALE = 1.24;
const BOARD_XS: readonly number[] = [-0.84, -0.42, 0.0, 0.42, 0.84];
const BOARD_Z = -0.26;
const BOARD_Y = 0.044;
const BOARD_TILT_X = 0.14;

// Pot placed left-center below the board and Hero cards pushed slightly forward with gentler tilt so Pot is never occluded
const POT_POS = { x: -0.48, z: 0.3 } as const;
const CALL_POS = { x: 0.6, z: 0.56 } as const;
const DEAL_ORIGIN = { x: 0.0, y: 0.06, z: -0.72 } as const;

const HERO_CARD_OFFSETS: readonly { readonly x: number; readonly z: number; readonly rotY: number }[] = [
  { x: -0.175, z: 0.96, rotY: 0.065 },
  { x: 0.175, z: 0.96, rotY: -0.065 },
];
const HERO_CARD_Y = 0.085;
const HERO_CARD_TILT_X = 0.36;
const HERO_FOLD_OFFSET = { x: 0, y: -0.062, z: -0.22 } as const;

const FOLDED_CARD_OPACITY = 0.42;
const ALL_TABLE_SEATS: readonly TableSeatId[] = ['hero', 'ca', 'cao', 'nong'];

interface SeatLayout {
  readonly id: TableSeatId;
  readonly cardPos: readonly [number, number, number];
  readonly cardRotY: number;
  readonly muckPos: readonly [number, number, number];
  readonly stackPos: readonly [number, number];
  readonly betPos: readonly [number, number];
  readonly actorRingPos: readonly [number, number];
  readonly actorRingScale: readonly [number, number];
  readonly bubblePos: readonly [number, number, number];
}

export const SEAT_LAYOUTS: Readonly<Record<TableSeatId, SeatLayout>> = {
  ca: {
    id: 'ca',
    cardPos: [-1.28, 0.005, -0.68],
    cardRotY: 0.92,
    muckPos: [-1.14, 0.005, -0.52],
    stackPos: [-1.54, -0.22],
    betPos: [-1.14, 0.08],
    actorRingPos: [-1.28, -0.68],
    actorRingScale: [1.18, 0.88],
    bubblePos: [-1.24, 0.42, -0.62],
  },
  cao: {
    id: 'cao',
    cardPos: [0.0, 0.005, -0.96],
    cardRotY: 0.0,
    muckPos: [0.0, 0.005, -0.76],
    stackPos: [0.58, -0.94],
    betPos: [-0.46, -0.78],
    actorRingPos: [0.0, -0.96],
    actorRingScale: [1.18, 0.88],
    bubblePos: [0.0, 0.44, -0.9],
  },
  nong: {
    id: 'nong',
    cardPos: [1.28, 0.005, -0.68],
    cardRotY: -0.92,
    muckPos: [1.14, 0.005, -0.52],
    stackPos: [1.54, -0.22],
    betPos: [1.14, 0.08],
    actorRingPos: [1.28, -0.68],
    actorRingScale: [1.18, 0.88],
    bubblePos: [1.24, 0.42, -0.62],
  },
  hero: {
    id: 'hero',
    cardPos: [0.0, HERO_CARD_Y, 0.96],
    cardRotY: 0.0,
    muckPos: [0.0, HERO_CARD_Y + HERO_FOLD_OFFSET.y, 0.96 + HERO_FOLD_OFFSET.z],
    stackPos: [-0.94, 0.76],
    betPos: [0.38, 0.56],
    actorRingPos: [0.0, 0.92],
    actorRingScale: [1.62, 0.92],
    bubblePos: [0.46, 0.34, 0.68],
  },
};

export const TABLETOP_METRICS = {
  boardCardScale: BOARD_CARD_SCALE,
  boardXs: BOARD_XS,
  boardZ: BOARD_Z,
  boardY: BOARD_Y,
  potPos: POT_POS,
  callPos: CALL_POS,
  heroCardZ: HERO_CARD_OFFSETS[0]!.z,
} as const;

function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const inv = 1 - clamped;
  return 1 - inv * inv * inv;
}

function serializeChipCounts(chips: ChipCounts): string {
  return DENOMINATIONS.map((d) => chips[d]).join(',');
}

function createCardMesh(
  frontTex: THREE.Texture,
  backTex: THREE.Texture,
  options: { readonly ghost?: boolean; readonly transparent?: boolean; readonly opacity?: number } = {},
): THREE.Mesh {
  const ghost = options.ghost ?? false;
  const opacity = options.opacity ?? 1;
  const transparent = options.transparent ?? (ghost || opacity < 1);

  const sideMat = createMatteMaterial(ghost ? 0xf3d4d4 : 0xeee5d5, {
    roughness: 0.9,
    transparent,
    opacity,
  });
  const frontMat = createMatteMaterial(0xffffff, {
    map: frontTex,
    roughness: ghost ? 0.65 : 0.78,
    metalness: 0.01,
    emissive: ghost ? 0xffe4e6 : 0x000000,
    emissiveIntensity: ghost ? 0.25 : 0,
    transparent,
    opacity,
  });
  const backMat = createMatteMaterial(0xffffff, {
    map: backTex,
    roughness: 0.82,
    transparent,
    opacity,
  });

  // BoxGeometry face order: +x, -x, +y (top), -y (bottom), +z, -z
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_THICK, CARD_H), [
    sideMat,
    sideMat,
    frontMat,
    backMat,
    sideMat,
    sideMat,
  ]);
  mesh.castShadow = !ghost && opacity >= 0.85;
  mesh.receiveShadow = !ghost;
  return mesh;
}

function setGroupOpacity(group: THREE.Object3D, opacity: number): void {
  const transparent = opacity < 0.999;
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat && 'opacity' in mat) {
        const std = mat as THREE.MeshStandardMaterial;
        std.transparent = transparent;
        std.opacity = opacity;
      }
    }
  });
}

function createHeartOutlineFrame(): THREE.Mesh {
  const outerW = CARD_W + 0.036;
  const outerH = CARD_H + 0.036;
  const innerW = CARD_W + 0.006;
  const innerH = CARD_H + 0.006;

  const shape = new THREE.Shape();
  shape.moveTo(-outerW / 2, -outerH / 2);
  shape.lineTo(outerW / 2, -outerH / 2);
  shape.lineTo(outerW / 2, outerH / 2);
  shape.lineTo(-outerW / 2, outerH / 2);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-innerW / 2, -innerH / 2);
  hole.lineTo(innerW / 2, -innerH / 2);
  hole.lineTo(innerW / 2, innerH / 2);
  hole.lineTo(-innerW / 2, innerH / 2);
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const mat = createMatteMaterial(SCENE_COLORS.highlightOuts, {
    roughness: 0.5,
    emissive: SCENE_COLORS.highlightOuts,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  return mesh;
}

function createHighlightRing(
  innerRadius: number,
  outerRadius: number,
  color: number,
  scaleX = 1,
  scaleZ = 1,
  options: { readonly emissiveIntensity?: number; readonly opacity?: number } = {},
): THREE.Mesh {
  const geo = new THREE.RingGeometry(innerRadius, outerRadius, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = createMatteMaterial(color, {
    roughness: 0.45,
    emissive: color,
    emissiveIntensity: options.emissiveIntensity ?? 0.65,
    transparent: true,
    opacity: options.opacity ?? 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(scaleX, 1, scaleZ);
  mesh.position.y = 0.006;
  mesh.visible = false;
  return mesh;
}

function buildChipStackMesh(
  count: number,
  edgeTex: THREE.Texture,
  topTex: THREE.Texture,
  x: number,
  z: number,
  transparent = false,
  opacity = 1,
): THREE.Group {
  const stack = new THREE.Group();
  stack.position.set(x, 0, z);

  const edgeMat = createMatteMaterial(0xffffff, {
    map: edgeTex,
    roughness: 0.78,
    transparent,
    opacity,
  });
  const topMat = createMatteMaterial(0xffffff, {
    map: topTex,
    roughness: 0.76,
    transparent,
    opacity,
  });
  const chipGeo = new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT, 24);

  for (let i = 0; i < count; i += 1) {
    const chip = new THREE.Mesh(chipGeo, [edgeMat, topMat, topMat]);
    // Slight deterministic offset so the stack looks organically hand-stacked
    const jitterX = Math.sin(i * 2.3 + x * 5) * 0.003;
    const jitterZ = Math.cos(i * 1.9 + z * 5) * 0.003;
    chip.position.set(jitterX, CHIP_HEIGHT * 0.5 + i * CHIP_HEIGHT, jitterZ);
    chip.rotation.y = i * 0.55;
    chip.castShadow = !transparent;
    chip.receiveShadow = true;
    stack.add(chip);
  }

  return stack;
}

/** A compact pile with one instanced mesh per denomination; dispose with the scene helpers. */
export function createChipPile(chips: ChipCounts, options: ChipPileOptions = {}): THREE.Group {
  const group = new THREE.Group();
  const stacks = buildChipStacks(chips, options.maxPerColumn ?? 10);
  const offsets = layoutChipColumns(stacks.length);
  const denominations = [...new Set(stacks.map((s) => s.denom.value))];
  for (const denomination of denominations) {
    const selected = stacks.filter((s) => s.denom.value === denomination);
    const spec = selected[0]!.denom;
    const edge = createChipEdgeTexture(spec.bodyHex, spec.stripeHex);
    const top = createChipTopTexture(spec.bodyHex, spec.stripeHex, spec.accentHex, String(spec.value));
    const mats = [createMatteMaterial(0xffffff, { map: edge }), createMatteMaterial(0xffffff, { map: top })];
    const geometry = new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT, 24);
    const mesh = new THREE.InstancedMesh(
      geometry,
      [mats[0]!, mats[1]!, mats[1]!],
      selected.reduce((n, s) => n + s.count, 0),
    );
    const dummy = new THREE.Object3D();
    let instance = 0;
    for (const stack of selected) {
      const column = stacks.indexOf(stack);
      const { x, z } = offsets[column]!;
      for (let i = 0; i < stack.count; i++) {
        dummy.position.set(x, CHIP_HEIGHT * (i + 0.5), z);
        dummy.rotation.y = i * 0.55;
        dummy.updateMatrix();
        mesh.setMatrixAt(instance++, dummy.matrix);
      }
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (options.scale !== undefined && options.scale !== 1) {
    group.scale.setScalar(options.scale);
  }
  return group;
}

interface ActiveAnimationRun {
  readonly startTimeMs: number;
  readonly totalDurationMs: number;
  readonly animations: readonly TableAnimation[];
  readonly dealFlyingCards: readonly {
    readonly mesh: THREE.Mesh;
    readonly seatId: TableSeatId;
    readonly cardSlotIdx: number;
    readonly startDelayMs: number;
    readonly durationMs: number;
    readonly endPos: readonly [number, number, number];
    readonly endRotY: number;
  }[];
  readonly chipFlights: readonly {
    readonly group: THREE.Group;
    readonly startDelayMs: number;
    readonly durationMs: number;
    readonly startPos: readonly [number, number, number];
    readonly endPos: readonly [number, number, number];
    readonly arcHeight: number;
    readonly shrinkAtEnd: boolean;
    readonly targetBetSeatId?: TableSeatId;
  }[];
  readonly hiddenBetSeats: ReadonlySet<TableSeatId>;
  readonly dealtSeats: ReadonlySet<TableSeatId>;
}

export function buildTabletop(initialSpot: SceneTableSnapshot): TabletopRig {
  const root = new THREE.Group();
  root.name = 'Tabletop';

  const cardBackTex = createCardBackTexture();
  const sharedTextures = new Set<THREE.Texture>([cardBackTex]);

  const clearGroup = (group: THREE.Group) => {
    for (const child of [...group.children]) {
      disposeObject3DResources(child, sharedTextures);
      group.remove(child);
    }
  };

  // --- Rival hole card groups (face down by default; in live showdown flipped strictly from seat.revealedCards) ---
  const rivalCardGroups: Record<SceneRival, THREE.Group> = {
    ca: new THREE.Group(),
    cao: new THREE.Group(),
    nong: new THREE.Group(),
  };
  const rivalCardKeys: Record<SceneRival, string> = { ca: '', cao: '', nong: '' };

  for (const rival of ALL_SCENE_RIVALS) {
    const pair = rivalCardGroups[rival];
    pair.name = `RivalCards-${rival}`;
    const layout = SEAT_LAYOUTS[rival];
    pair.position.set(layout.cardPos[0], layout.cardPos[1], layout.cardPos[2]);
    pair.rotation.y = layout.cardRotY;
    root.add(pair);
  }

  // --- Live-only per-seat visuals (stacks, bets, actor glow, winner highlight, action bubbles) ---
  const liveSeatsRoot = new THREE.Group();
  liveSeatsRoot.name = 'LiveSeats';
  root.add(liveSeatsRoot);

  const seatStackGroups = {} as Record<TableSeatId, THREE.Group>;
  const seatBetGroups = {} as Record<TableSeatId, THREE.Group>;
  const seatActorRings = {} as Record<TableSeatId, THREE.Mesh>;
  const seatWinnerRings = {} as Record<TableSeatId, THREE.Mesh>;
  const seatBubbles = {} as Record<TableSeatId, THREE.Sprite>;
  const seatStackKeys: Record<TableSeatId, string> = { hero: '', ca: '', cao: '', nong: '' };
  const seatBetKeys: Record<TableSeatId, string> = { hero: '', ca: '', cao: '', nong: '' };
  const seatBubbleKeys: Record<TableSeatId, string> = { hero: '', ca: '', cao: '', nong: '' };

  for (const seatId of ALL_TABLE_SEATS) {
    const layout = SEAT_LAYOUTS[seatId];

    const stackGroup = new THREE.Group();
    stackGroup.name = `SeatStack-${seatId}`;
    stackGroup.position.set(layout.stackPos[0], 0, layout.stackPos[1]);
    liveSeatsRoot.add(stackGroup);
    seatStackGroups[seatId] = stackGroup;

    const betGroup = new THREE.Group();
    betGroup.name = `SeatBet-${seatId}`;
    betGroup.position.set(layout.betPos[0], 0, layout.betPos[1]);
    liveSeatsRoot.add(betGroup);
    seatBetGroups[seatId] = betGroup;

    const actorRing = createHighlightRing(
      0.24,
      0.32,
      SCENE_COLORS.highlightPot,
      layout.actorRingScale[0],
      layout.actorRingScale[1],
      { emissiveIntensity: 0.72, opacity: 0.85 },
    );
    actorRing.name = `SeatActorRing-${seatId}`;
    actorRing.position.set(layout.actorRingPos[0], 0.0055, layout.actorRingPos[1]);
    actorRing.rotation.y = layout.cardRotY;
    liveSeatsRoot.add(actorRing);
    seatActorRings[seatId] = actorRing;

    const winnerRing = createHighlightRing(
      0.31,
      0.41,
      SCENE_COLORS.highlightTotal,
      layout.actorRingScale[0] * 1.08,
      layout.actorRingScale[1] * 1.08,
      { emissiveIntensity: 0.88, opacity: 0.92 },
    );
    winnerRing.name = `SeatWinnerRing-${seatId}`;
    winnerRing.position.set(layout.actorRingPos[0], 0.0062, layout.actorRingPos[1]);
    winnerRing.rotation.y = layout.cardRotY;
    liveSeatsRoot.add(winnerRing);
    seatWinnerRings[seatId] = winnerRing;

    const bubbleMat = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const bubble = new THREE.Sprite(bubbleMat);
    bubble.name = `SeatBubble-${seatId}`;
    bubble.position.set(layout.bubblePos[0], layout.bubblePos[1], layout.bubblePos[2]);
    bubble.scale.set(0.68, 0.19, 1);
    bubble.visible = false;
    liveSeatsRoot.add(bubble);
    seatBubbles[seatId] = bubble;
  }

  // Decorative fixture seat chip stacks + dealer puck (shown in Drill fixture mode only; hidden in live mode)
  const fixtureSeatPropsGroup = new THREE.Group();
  fixtureSeatPropsGroup.name = 'FixtureSeatProps';
  const seatStacks: readonly {
    x: number;
    z: number;
    body: string;
    stripe: string;
    accent: string;
    label: string;
    count: number;
  }[] = [
    // Cá
    { x: -1.42, z: -0.34, body: CHIP_DENOMS[10].bodyHex, stripe: CHIP_DENOMS[10].stripeHex, accent: CHIP_DENOMS[10].accentHex, label: '10', count: 5 },
    { x: -1.28, z: -0.26, body: CHIP_DENOMS[100].bodyHex, stripe: CHIP_DENOMS[100].stripeHex, accent: CHIP_DENOMS[100].accentHex, label: '100', count: 3 },
    // Cáo
    { x: 0.46, z: -0.95, body: CHIP_DENOMS[100].bodyHex, stripe: CHIP_DENOMS[100].stripeHex, accent: CHIP_DENOMS[100].accentHex, label: '100', count: 6 },
    { x: 0.6, z: -0.88, body: CHIP_DENOMS[50].bodyHex, stripe: CHIP_DENOMS[50].stripeHex, accent: CHIP_DENOMS[50].accentHex, label: '50', count: 3 },
    // Nóng
    { x: 1.42, z: -0.34, body: CHIP_DENOMS[50].bodyHex, stripe: CHIP_DENOMS[50].stripeHex, accent: CHIP_DENOMS[50].accentHex, label: '50', count: 5 },
    { x: 1.28, z: -0.26, body: CHIP_DENOMS[5].bodyHex, stripe: CHIP_DENOMS[5].stripeHex, accent: CHIP_DENOMS[5].accentHex, label: '5', count: 4 },
    // Hero personal reserve stack (left side of Hero)
    { x: -0.94, z: 0.82, body: CHIP_DENOMS[100].bodyHex, stripe: CHIP_DENOMS[100].stripeHex, accent: CHIP_DENOMS[100].accentHex, label: '100', count: 5 },
    { x: -0.78, z: 0.88, body: CHIP_DENOMS[10].bodyHex, stripe: CHIP_DENOMS[10].stripeHex, accent: CHIP_DENOMS[10].accentHex, label: '10', count: 6 },
  ];

  for (const s of seatStacks) {
    const edgeTex = createChipEdgeTexture(s.body, s.stripe);
    const topTex = createChipTopTexture(s.body, s.stripe, s.accent, s.label);
    fixtureSeatPropsGroup.add(buildChipStackMesh(s.count, edgeTex, topTex, s.x, s.z));
  }

  // Dealer button puck near Cáo/Cá (fixture mode only)
  const dealerBtn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.088, 0.024, 24),
    createMatteMaterial(SCENE_COLORS.ivory, { roughness: 0.72 }),
  );
  dealerBtn.position.set(-0.92, 0.013, -0.62);
  dealerBtn.castShadow = true;
  fixtureSeatPropsGroup.add(dealerBtn);
  root.add(fixtureSeatPropsGroup);

  // Subtle empty River slot marker on the felt (5th board card position)
  const riverSlotX = BOARD_XS[4] ?? 0.84;
  const riverSlotZ = BOARD_Z;
  const riverSlotTex = createRiverSlotTexture();
  const riverSlot = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_W * BOARD_CARD_SCALE, CARD_H * BOARD_CARD_SCALE),
    createMatteMaterial(0xffffff, {
      map: riverSlotTex,
      roughness: 0.9,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    }),
  );
  riverSlot.rotation.x = -Math.PI / 2;
  riverSlot.position.set(riverSlotX, 0.004, riverSlotZ);
  root.add(riverSlot);

  // --- Highlight Rings & Visual Indicators (Drill lessons + Pot halo) ---
  // 1. Pot center halo (surrounds POT_POS, unoccluded by Hero cards)
  const potRing = createHighlightRing(0.34, 0.4, SCENE_COLORS.highlightPot, 1.24, 0.96);
  potRing.position.set(POT_POS.x, 0.006, POT_POS.z);
  root.add(potRing);

  // 2. Hero Call zone halo (Drill mode: surrounds CALL_POS)
  const callRing = createHighlightRing(0.22, 0.275, SCENE_COLORS.highlightCall, 1.15, 1.0);
  callRing.position.set(CALL_POS.x, 0.006, CALL_POS.z);
  root.add(callRing);

  // 3. Total pot after call unified halo (Drill mode: encompasses BOTH Pot + Call together)
  const totalRing = createHighlightRing(0.82, 0.89, SCENE_COLORS.highlightTotal, 1.18, 0.62);
  totalRing.position.set((POT_POS.x + CALL_POS.x) / 2, 0.0055, (POT_POS.z + CALL_POS.z) / 2);
  totalRing.rotation.y = -0.24;
  root.add(totalRing);

  // 4. River Outs halo under the open River slot
  const riverOutsRing = createHighlightRing(
    0.22 * BOARD_CARD_SCALE,
    0.27 * BOARD_CARD_SCALE,
    SCENE_COLORS.highlightOuts,
    0.95,
    1.22,
  );
  riverOutsRing.position.set(riverSlotX, 0.006, riverSlotZ);
  root.add(riverOutsRing);

  // Dynamic groups rebuilt when spot cards/amounts change
  const boardGroup = new THREE.Group();
  boardGroup.name = 'BoardCards';
  root.add(boardGroup);

  const heroCardsGroup = new THREE.Group();
  heroCardsGroup.name = 'HeroCards';
  root.add(heroCardsGroup);

  const potChipsGroup = new THREE.Group();
  potChipsGroup.name = 'PotChips';
  potChipsGroup.position.set(POT_POS.x, 0, POT_POS.z);
  root.add(potChipsGroup);

  const callChipsGroup = new THREE.Group();
  callChipsGroup.name = 'CallChips';
  callChipsGroup.position.set(CALL_POS.x, 0, CALL_POS.z);
  root.add(callChipsGroup);

  const outsFanGroup = new THREE.Group();
  outsFanGroup.name = 'OutsFan';
  outsFanGroup.position.set(riverSlotX, 0.24, riverSlotZ - 0.02);
  outsFanGroup.visible = false;
  root.add(outsFanGroup);

  const animFxGroup = new THREE.Group();
  animFxGroup.name = 'TableAnimFx';
  root.add(animFxGroup);

  let boardCardHolders: THREE.Group[] = [];
  let seenHeartFrames: THREE.Mesh[] = [];
  let currentHighlight: LessonHighlight = null;
  let currentSpot: SceneTableSnapshot = initialSpot;
  let currentCardsAndChipsKey = '';
  let activeRun: ActiveAnimationRun | null = null;

  const findLiveSeat = (spot: SceneTableSnapshot, seatId: TableSeatId): PublicTableSeat | undefined =>
    spot.live?.seats.find((s) => s.id === seatId);

  const rebuildRivalCards = (
    rival: SceneRival,
    mode: 'face-down' | 'folded' | 'revealed',
    revealedCards: readonly string[] | null,
  ) => {
    const pair = rivalCardGroups[rival];
    clearGroup(pair);
    const layout = SEAT_LAYOUTS[rival];

    if (mode === 'revealed' && revealedCards && revealedCards.length > 0) {
      pair.position.set(layout.cardPos[0], layout.cardPos[1], layout.cardPos[2]);
      pair.rotation.y = layout.cardRotY;
      revealedCards.slice(0, 2).forEach((cardStr, i) => {
        // Strictly use revealedCards for face textures
        const faceTex = createCardFaceTexture(cardStr);
        const card = createCardMesh(faceTex, cardBackTex);
        card.scale.set(0.92, 1, 0.92);
        card.position.set(i === 0 ? -0.145 : 0.145, 0.025 + i * 0.003, 0);
        card.rotation.x = 0.16;
        card.rotation.y = i === 0 ? 0.08 : -0.08;
        card.userData.cardKind = 'revealed';
        pair.add(card);
      });
      return;
    }

    const folded = mode === 'folded';
    const pos = folded ? layout.muckPos : layout.cardPos;
    pair.position.set(pos[0], pos[1], pos[2]);
    pair.rotation.y = layout.cardRotY;

    for (let i = 0; i < 2; i += 1) {
      // Face-down cards use cardBackTex on BOTH faces — never a hidden hole card
      const card = createCardMesh(cardBackTex, cardBackTex, {
        transparent: folded,
        opacity: folded ? FOLDED_CARD_OPACITY : 1,
      });
      card.scale.set(0.78, 1, 0.78);
      card.position.set(i === 0 ? -0.075 : 0.075, i * 0.003, i === 0 ? 0.01 : -0.01);
      card.rotation.y = i === 0 ? 0.14 : -0.14;
      card.userData.cardKind = folded ? 'folded' : 'face-down';
      pair.add(card);
    }
  };

  const restoreRestingTransforms = () => {
    const isLive = isLiveSnapshot(currentSpot);

    // Restore board cards to resting grid positions
    boardCardHolders.forEach((holder, idx) => {
      const bx = BOARD_XS[idx] ?? riverSlotX;
      holder.visible = true;
      holder.position.set(bx, BOARD_Y, BOARD_Z);
      holder.rotation.set(BOARD_TILT_X, 0, 0);
    });

    // Restore Hero card group resting transform & opacity
    const heroSeat = findLiveSeat(currentSpot, 'hero');
    const heroFolded = isLive && heroSeat?.status === 'folded';
    heroCardsGroup.visible = !isLive || (heroSeat?.status !== 'out' && currentSpot.heroCards.length > 0);
    heroCardsGroup.position.set(
      heroFolded ? HERO_FOLD_OFFSET.x : 0,
      heroFolded ? HERO_FOLD_OFFSET.y : 0,
      heroFolded ? HERO_FOLD_OFFSET.z : 0,
    );
    setGroupOpacity(heroCardsGroup, heroFolded ? FOLDED_CARD_OPACITY : 1);

    // Restore rival card groups resting transform, flip & opacity
    for (const rival of ALL_SCENE_RIVALS) {
      const pair = rivalCardGroups[rival];
      const layout = SEAT_LAYOUTS[rival];
      const seat = findLiveSeat(currentSpot, rival);
      const isVisible = !isLive
        ? true
        : currentSpot.live?.street !== null &&
          (seat ? seat.status !== 'out' : isRivalCardsVisible(currentSpot, rival));
      pair.visible = isVisible;

      const isFolded = isLive && seat?.status === 'folded';
      const pos = isFolded ? layout.muckPos : layout.cardPos;
      pair.position.set(pos[0], pos[1], pos[2]);
      pair.rotation.set(0, layout.cardRotY, 0);
      setGroupOpacity(pair, isFolded ? FOLDED_CARD_OPACITY : 1);

      pair.children.forEach((child, i) => {
        if (child.userData.cardKind === 'revealed') {
          child.position.set(i === 0 ? -0.145 : 0.145, 0.025 + i * 0.003, 0);
          child.rotation.set(0.16, i === 0 ? 0.08 : -0.08, 0);
        } else {
          child.position.set(i === 0 ? -0.075 : 0.075, i * 0.003, i === 0 ? 0.01 : -0.01);
          child.rotation.set(0, i === 0 ? 0.14 : -0.14, 0);
        }
      });
    }

    // Restore bet pile visibility & winner ring resting scale/opacity
    for (const seatId of ALL_TABLE_SEATS) {
      seatBetGroups[seatId].visible = isLive;
      const layout = SEAT_LAYOUTS[seatId];
      const winnerRing = seatWinnerRings[seatId];
      winnerRing.scale.set(layout.actorRingScale[0] * 1.08, 1, layout.actorRingScale[1] * 1.08);
      const mat = winnerRing.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.92;
    }
  };

  const snapAnimations = () => {
    if (activeRun !== null) {
      clearGroup(animFxGroup);
      activeRun = null;
    }
    restoreRestingTransforms();
  };

  const updateSeatBubble = (seatId: TableSeatId, seat: PublicTableSeat | undefined, showLive: boolean) => {
    const sprite = seatBubbles[seatId];
    const spec = showLive && seat ? formatSeatActionBubble(seat) : null;
    if (!spec) {
      sprite.visible = false;
      return;
    }

    const nextKey = `${spec.tone}:${spec.label}`;
    if (seatBubbleKeys[seatId] !== nextKey) {
      const mat = sprite.material;
      const prevMap = mat.map;
      mat.map = createActionBubbleTexture(spec);
      mat.needsUpdate = true;
      prevMap?.dispose();
      seatBubbleKeys[seatId] = nextKey;
    }
    sprite.visible = true;
  };

  const applyHighlightState = (highlight: LessonHighlight) => {
    currentHighlight = highlight;
    const isLive = isLiveSnapshot(currentSpot);
    const effective = getEffectiveHighlight(currentSpot, highlight);
    const showOuts = shouldShowOuts(currentSpot, highlight);

    potRing.visible = (effective === 'pot' || effective === 'total') && currentSpot.pot > 0;
    callRing.visible = !isLive && (effective === 'call' || effective === 'total') && currentSpot.call > 0;
    totalRing.visible = !isLive && effective === 'total';
    riverOutsRing.visible = showOuts;
    outsFanGroup.visible = showOuts;

    // Subtle elevation lift on highlighted chip clusters for instant tactile feedback
    potChipsGroup.position.y = effective === 'pot' || effective === 'total' ? 0.032 : 0;
    callChipsGroup.position.y = !isLive && (effective === 'call' || effective === 'total') ? 0.036 : 0;

    // Emphasize the seen heart cards slightly when showing the flush draw outs in Drill mode
    for (const frame of seenHeartFrames) {
      frame.visible = showOuts;
    }
  };

  const updateLiveSeats = (spot: SceneTableSnapshot) => {
    const isLive = isLiveSnapshot(spot);
    liveSeatsRoot.visible = isLive;

    if (!isLive || !spot.live) {
      // Drill mode: ensure all 3 rivals show face-down cards and zero live overlays
      for (const rival of ALL_SCENE_RIVALS) {
        if (rivalCardKeys[rival] !== 'drill:face-down') {
          rebuildRivalCards(rival, 'face-down', null);
          rivalCardKeys[rival] = 'drill:face-down';
        }
        rivalCardGroups[rival].visible = true;
      }
      return;
    }

    const live = spot.live;
    const occupiedSet = new Set<SceneRival>(getOccupiedRivals(spot));
    const inHand = live.street !== null;
    const handSettled = live.payoutTransfers.length > 0;

    // Update rival cards (strictly face-down unless seat.revealedCards is non-null)
    for (const rival of ALL_SCENE_RIVALS) {
      const seat = findLiveSeat(spot, rival);
      if (!inHand || (seat ? seat.status === 'out' : !occupiedSet.has(rival))) {
        rivalCardGroups[rival].visible = false;
        continue;
      }

      const isFolded = seat?.status === 'folded';
      const hasReveal =
        !isFolded &&
        seat?.revealedCards !== null &&
        seat?.revealedCards !== undefined &&
        seat.revealedCards.length > 0;

      const cardMode: 'face-down' | 'folded' | 'revealed' = isFolded
        ? 'folded'
        : hasReveal
          ? 'revealed'
          : 'face-down';
      const nextCardKey =
        cardMode === 'revealed'
          ? `live:revealed:${seat!.revealedCards!.join(',')}`
          : `live:${cardMode}`;

      if (rivalCardKeys[rival] !== nextCardKey) {
        rebuildRivalCards(rival, cardMode, hasReveal ? seat!.revealedCards : null);
        rivalCardKeys[rival] = nextCardKey;
      }
      rivalCardGroups[rival].visible = true;
    }

    // Update per-seat stacks, bets, actor glow, winner highlight, and action bubble
    for (const seatId of ALL_TABLE_SEATS) {
      const seat = findLiveSeat(spot, seatId);

      // 1. Physical stack pile near seat's rail (real denominations only, compact columns)
      const stackGroup = seatStackGroups[seatId];
      const nextStackKey = seat ? serializeChipCounts(seat.stackChips) : 'empty';
      if (seatStackKeys[seatId] !== nextStackKey) {
        clearGroup(stackGroup);
        if (seat && countTotalChips(seat.stackChips) > 0) {
          stackGroup.add(createChipPile(seat.stackChips, { maxPerColumn: 16, scale: 0.76 }));
        }
        seatStackKeys[seatId] = nextStackKey;
      }

      // 2. Physical bet pile between seat and pot (hidden between hands or after payout settlement)
      const betGroup = seatBetGroups[seatId];
      const showBet = inHand && !handSettled && seat !== undefined && countTotalChips(seat.streetChips) > 0;
      const nextBetKey = showBet && seat ? serializeChipCounts(seat.streetChips) : 'empty';
      if (seatBetKeys[seatId] !== nextBetKey) {
        clearGroup(betGroup);
        if (showBet && seat) {
          betGroup.add(createChipPile(seat.streetChips, { scale: 0.88 }));
        }
        seatBetKeys[seatId] = nextBetKey;
      }
      betGroup.visible = true;

      // 3. Actor glow on felt
      const isActor = seat
        ? seat.isActor
        : seatId !== 'hero' && live.activeRival === seatId && occupiedSet.has(seatId);
      seatActorRings[seatId].visible = inHand && isActor;

      // 4. Winner highlight ring
      seatWinnerRings[seatId].visible = inHand && Boolean(seat?.isWinner);

      // 5. Action bubble billboard
      updateSeatBubble(seatId, seat, inHand);
    }
  };

  const updateSpot = (spot: SceneTableSnapshot) => {
    currentSpot = spot;
    const isLive = isLiveSnapshot(spot);

    // Toggle Drill-only seat props, Call pile, and River placeholder
    fixtureSeatPropsGroup.visible = !isLive;
    callChipsGroup.visible = !isLive;
    riverSlot.visible = shouldShowRiverPlaceholder(spot);

    updateLiveSeats(spot);

    const heroSeat = findLiveSeat(spot, 'hero');
    const heroStatus = isLive ? (heroSeat?.status ?? 'active') : 'active';
    const cardsAndChipsKey = [
      isLive ? 'L' : 'D',
      String(spot.pot),
      spot.live ? serializeChipCounts(spot.live.potChips) : 'drill',
      isLive ? '0' : String(spot.call),
      heroStatus,
      spot.heroCards.join(','),
      spot.board.join(','),
    ].join(':');

    if (cardsAndChipsKey === currentCardsAndChipsKey) {
      applyHighlightState(currentHighlight);
      return;
    }
    currentCardsAndChipsKey = cardsAndChipsKey;

    clearGroup(boardGroup);
    clearGroup(heroCardsGroup);
    clearGroup(potChipsGroup);
    clearGroup(callChipsGroup);
    clearGroup(outsFanGroup);
    boardCardHolders = [];
    seenHeartFrames = [];

    // 1. Community Cards (0-5 enlarged, slightly tilted cards for crisp legibility)
    spot.board.slice(0, 5).forEach((cardStr, idx) => {
      const bx = BOARD_XS[idx] ?? riverSlotX;
      const faceTex = createCardFaceTexture(cardStr);
      const holder = new THREE.Group();
      holder.name = `BoardCard-${idx}`;
      holder.position.set(bx, BOARD_Y, BOARD_Z);
      holder.rotation.x = BOARD_TILT_X;

      const cardMesh = createCardMesh(faceTex, cardBackTex);
      cardMesh.scale.set(BOARD_CARD_SCALE, 1, BOARD_CARD_SCALE);
      holder.add(cardMesh);

      if (!isLive && parseCard(cardStr).isHeart) {
        const frame = createHeartOutlineFrame();
        frame.scale.set(BOARD_CARD_SCALE, 1, BOARD_CARD_SCALE);
        frame.position.y = -0.004;
        holder.add(frame);
        seenHeartFrames.push(frame);
      }

      boardGroup.add(holder);
      boardCardHolders.push(holder);
    });

    // 2. Hero Hole Cards (0-2 cards; hidden when status is 'out', slid & faded when 'folded')
    const heroFolded = isLive && heroStatus === 'folded';
    const showHeroCards = !isLive || (heroStatus !== 'out' && spot.heroCards.length > 0);
    heroCardsGroup.visible = showHeroCards;
    heroCardsGroup.position.set(
      heroFolded ? HERO_FOLD_OFFSET.x : 0,
      heroFolded ? HERO_FOLD_OFFSET.y : 0,
      heroFolded ? HERO_FOLD_OFFSET.z : 0,
    );

    if (showHeroCards) {
      spot.heroCards.slice(0, 2).forEach((cardStr, idx) => {
        const offset = HERO_CARD_OFFSETS[idx] ?? { x: 0, z: 0.96, rotY: 0 };
        const faceTex = createCardFaceTexture(cardStr);
        const cardHolder = new THREE.Group();
        cardHolder.position.set(offset.x, HERO_CARD_Y, offset.z);
        cardHolder.rotation.y = offset.rotY;
        cardHolder.rotation.x = heroFolded ? 0.1 : HERO_CARD_TILT_X;

        const cardMesh = createCardMesh(faceTex, cardBackTex, {
          transparent: heroFolded,
          opacity: heroFolded ? FOLDED_CARD_OPACITY : 1,
        });
        cardMesh.scale.set(1.04, 1, 1.04);
        cardHolder.add(cardMesh);

        if (!isLive && parseCard(cardStr).isHeart) {
          const frame = createHeartOutlineFrame();
          frame.scale.set(1.06, 1, 1.06);
          frame.position.y = -0.004;
          cardHolder.add(frame);
          seenHeartFrames.push(frame);
        }

        heroCardsGroup.add(cardHolder);
      });
    }

    // 3. Real pot counts in live mode; hypothetical Drill amounts in Drill mode
    const potChips = spot.live ? spot.live.potChips : chipsForAmount(spot.pot);
    if (countTotalChips(potChips) > 0) {
      potChipsGroup.add(createChipPile(potChips));
    }

    // 4. Hypothetical Call pile strictly in Drill mode
    if (!isLive && spot.call > 0) {
      callChipsGroup.add(createChipPile(chipsForAmount(spot.call)));
    }

    // 5. Ghostly Unseen Heart Outs Fan (Drill mode only — live mode shows no assumption ghost outs)
    if (!isLive) {
      const unseenHearts = getUnseenHearts(spot);
      const total = unseenHearts.length;
      unseenHearts.forEach((heartCard, idx) => {
        const norm = total > 1 ? idx / (total - 1) - 0.5 : 0; // -0.5 .. +0.5
        const faceTex = createCardFaceTexture(heartCard, { ghost: true });
        const ghostCard = createCardMesh(faceTex, cardBackTex, { ghost: true, opacity: 0.86 });
        ghostCard.scale.set(0.62, 0.6, 0.62);
        // ZYX order: tilt upright facing the player first (X), then fan cleanly in the card plane (Z)
        ghostCard.rotation.order = 'ZYX';
        ghostCard.rotation.x = Math.PI / 2 - 0.34;
        ghostCard.rotation.z = -norm * 0.58;
        ghostCard.position.set(
          norm * 0.64,
          0.11 + (1 - Math.abs(norm * 2)) * 0.08,
          idx * 0.008 - 0.04,
        );
        outsFanGroup.add(ghostCard);
      });
    }

    applyHighlightState(currentHighlight);
  };

  const playAnimations = (animations: readonly TableAnimation[], nowMs: number) => {
    snapAnimations();
    if (!isLiveSnapshot(currentSpot) || animations.length === 0) {
      return;
    }

    const totalDurationMs = getPlanDurationMs(animations);
    if (totalDurationMs <= 0) {
      return;
    }

    const dealFlyingCards: ActiveAnimationRun['dealFlyingCards'][number][] = [];
    const chipFlights: ActiveAnimationRun['chipFlights'][number][] = [];
    const hiddenBetSeats = new Set<TableSeatId>();
    const dealtSeats = new Set<TableSeatId>();

    for (const anim of animations) {
      switch (anim.type) {
        case 'deal-hand': {
          // Deal round-robin, 1 card to each seat at a time, starting from DEAL_ORIGIN
          let orderIdx = 0;
          for (let cardSlotIdx = 0; cardSlotIdx < anim.cardsPerSeat; cardSlotIdx += 1) {
            for (const seatId of anim.seatIds) {
              dealtSeats.add(seatId);
              const layout = SEAT_LAYOUTS[seatId];
              const flyingCard = createCardMesh(cardBackTex, cardBackTex);
              const scale = seatId === 'hero' ? 0.92 : 0.78;
              flyingCard.scale.set(scale, 1, scale);
              flyingCard.position.set(DEAL_ORIGIN.x, DEAL_ORIGIN.y, DEAL_ORIGIN.z);
              flyingCard.visible = false;
              animFxGroup.add(flyingCard);

              const slotOffsetX = cardSlotIdx === 0 ? -0.075 : 0.075;
              const endPos: readonly [number, number, number] =
                seatId === 'hero'
                  ? [
                      HERO_CARD_OFFSETS[cardSlotIdx]?.x ?? 0,
                      HERO_CARD_Y,
                      HERO_CARD_OFFSETS[cardSlotIdx]?.z ?? 0.96,
                    ]
                  : [layout.cardPos[0] + slotOffsetX, layout.cardPos[1] + 0.01, layout.cardPos[2]];

              dealFlyingCards.push({
                mesh: flyingCard,
                seatId,
                cardSlotIdx,
                startDelayMs: anim.delayMs + orderIdx * anim.staggerMs,
                durationMs: anim.cardDurationMs,
                endPos,
                endRotY: layout.cardRotY,
              });
              orderIdx += 1;
            }
          }
          break;
        }

        case 'bet-chips': {
          const layout = SEAT_LAYOUTS[anim.seatId];
          const pile = createChipPile(anim.chips, { scale: 0.88 });
          pile.position.set(layout.stackPos[0], 0.01, layout.stackPos[1]);
          pile.visible = false;
          animFxGroup.add(pile);
          hiddenBetSeats.add(anim.seatId);
          chipFlights.push({
            group: pile,
            startDelayMs: anim.delayMs,
            durationMs: anim.durationMs,
            startPos: [layout.stackPos[0], 0.01, layout.stackPos[1]],
            endPos: [layout.betPos[0], 0.01, layout.betPos[1]],
            arcHeight: 0.12,
            shrinkAtEnd: false,
            targetBetSeatId: anim.seatId,
          });
          break;
        }

        case 'street-sweep': {
          for (const source of anim.fromSeats) {
            const layout = SEAT_LAYOUTS[source.seatId];
            const pile = createChipPile(source.chips, { scale: 0.88 });
            pile.position.set(layout.betPos[0], 0.01, layout.betPos[1]);
            pile.visible = false;
            animFxGroup.add(pile);
            chipFlights.push({
              group: pile,
              startDelayMs: anim.delayMs,
              durationMs: anim.durationMs,
              startPos: [layout.betPos[0], 0.01, layout.betPos[1]],
              endPos: [POT_POS.x, 0.01, POT_POS.z],
              arcHeight: 0.08,
              shrinkAtEnd: true,
            });
          }
          break;
        }

        case 'payout': {
          for (const transfer of anim.transfers) {
            const layout = SEAT_LAYOUTS[transfer.seatId];
            // Slide exact payout chips from pot to winner
            const pile = createChipPile(transfer.chips, { scale: 0.86 });
            pile.position.set(POT_POS.x, 0.01, POT_POS.z);
            pile.visible = false;
            animFxGroup.add(pile);
            chipFlights.push({
              group: pile,
              startDelayMs: anim.delayMs,
              durationMs: anim.durationMs,
              startPos: [POT_POS.x, 0.01, POT_POS.z],
              endPos: [layout.stackPos[0], 0.01, layout.stackPos[1]],
              arcHeight: 0.13,
              shrinkAtEnd: true,
            });
          }
          break;
        }

        case 'deal-board':
        case 'fold-seat':
        case 'showdown-reveal':
          // Animated directly on the real card holders in stepAnimations
          break;
      }
    }

    activeRun = {
      startTimeMs: nowMs,
      totalDurationMs,
      animations,
      dealFlyingCards,
      chipFlights,
      hiddenBetSeats,
      dealtSeats,
    };

    // Apply t=0 frame immediately so cards/chips start cleanly at their origin
    stepAnimations(nowMs);
  };

  const stepAnimations = (nowMs: number): boolean => {
    if (activeRun === null) {
      return false;
    }

    const run = activeRun;
    const elapsed = Math.max(0, nowMs - run.startTimeMs);
    if (elapsed >= run.totalDurationMs) {
      snapAnimations();
      return false;
    }

    // 1. Deal hand flying cards
    if (run.dealtSeats.size > 0) {
      const seatComplete = new Map<TableSeatId, boolean>();
      for (const seatId of run.dealtSeats) {
        seatComplete.set(seatId, true);
      }

      for (const card of run.dealFlyingCards) {
        const local = elapsed - card.startDelayMs;
        if (local < 0) {
          card.mesh.visible = false;
          seatComplete.set(card.seatId, false);
        } else if (local < card.durationMs) {
          const u = easeOutCubic(local / card.durationMs);
          card.mesh.visible = true;
          card.mesh.position.set(
            DEAL_ORIGIN.x + (card.endPos[0] - DEAL_ORIGIN.x) * u,
            DEAL_ORIGIN.y + (card.endPos[1] - DEAL_ORIGIN.y) * u + Math.sin(u * Math.PI) * 0.14,
            DEAL_ORIGIN.z + (card.endPos[2] - DEAL_ORIGIN.z) * u,
          );
          card.mesh.rotation.y = card.endRotY * u;
          seatComplete.set(card.seatId, false);
        } else {
          card.mesh.visible = false;
        }
      }

      for (const [seatId, done] of seatComplete) {
        if (seatId === 'hero') {
          heroCardsGroup.visible = done && currentSpot.heroCards.length > 0;
        } else {
          const seat = findLiveSeat(currentSpot, seatId);
          rivalCardGroups[seatId].visible = done && seat?.status !== 'out';
        }
      }
    }

    // 2. Flying chip piles (bet, street-sweep, payout)
    for (const seatId of run.hiddenBetSeats) {
      seatBetGroups[seatId].visible = false;
    }
    for (const flight of run.chipFlights) {
      const local = elapsed - flight.startDelayMs;
      if (local < 0) {
        flight.group.visible = false;
      } else if (local < flight.durationMs) {
        const u = easeOutCubic(local / flight.durationMs);
        flight.group.visible = true;
        flight.group.position.set(
          flight.startPos[0] + (flight.endPos[0] - flight.startPos[0]) * u,
          flight.startPos[1] +
            (flight.endPos[1] - flight.startPos[1]) * u +
            Math.sin(u * Math.PI) * flight.arcHeight,
          flight.startPos[2] + (flight.endPos[2] - flight.startPos[2]) * u,
        );
        if (flight.shrinkAtEnd && u > 0.82) {
          const fade = Math.max(0.2, 1 - (u - 0.82) / 0.18);
          flight.group.scale.setScalar(0.86 * fade);
        }
      } else {
        flight.group.visible = false;
        if (flight.targetBetSeatId) {
          seatBetGroups[flight.targetBetSeatId].visible = true;
        }
      }
    }

    // 3. Direct-transform animations (deal-board, fold-seat, showdown-reveal, winner pulse)
    for (const anim of run.animations) {
      switch (anim.type) {
        case 'deal-board': {
          for (let idx = anim.fromIndex; idx < anim.toIndex; idx += 1) {
            const holder = boardCardHolders[idx];
            if (!holder) {
              continue;
            }
            const targetX = BOARD_XS[idx] ?? riverSlotX;
            const local = elapsed - (anim.delayMs + (idx - anim.fromIndex) * anim.staggerMs);
            if (local < 0) {
              holder.visible = false;
            } else if (local < anim.cardDurationMs) {
              const u = easeOutCubic(local / anim.cardDurationMs);
              holder.visible = true;
              holder.position.set(
                DEAL_ORIGIN.x + (targetX - DEAL_ORIGIN.x) * u,
                DEAL_ORIGIN.y + (BOARD_Y - DEAL_ORIGIN.y) * u + Math.sin(u * Math.PI) * 0.2,
                DEAL_ORIGIN.z + (BOARD_Z - DEAL_ORIGIN.z) * u,
              );
              holder.rotation.set(BOARD_TILT_X * u, 0, (1 - u) * Math.PI);
            } else {
              holder.visible = true;
              holder.position.set(targetX, BOARD_Y, BOARD_Z);
              holder.rotation.set(BOARD_TILT_X, 0, 0);
            }
          }
          break;
        }

        case 'fold-seat': {
          const local = elapsed - anim.delayMs;
          const u = local <= 0 ? 0 : easeOutCubic(local / anim.durationMs);
          const opacity = 1 + (FOLDED_CARD_OPACITY - 1) * u;
          if (anim.seatId === 'hero') {
            heroCardsGroup.position.set(
              HERO_FOLD_OFFSET.x * u,
              HERO_FOLD_OFFSET.y * u,
              HERO_FOLD_OFFSET.z * u,
            );
            setGroupOpacity(heroCardsGroup, opacity);
          } else {
            const layout = SEAT_LAYOUTS[anim.seatId];
            const pair = rivalCardGroups[anim.seatId];
            pair.position.set(
              layout.cardPos[0] + (layout.muckPos[0] - layout.cardPos[0]) * u,
              layout.cardPos[1] + (layout.muckPos[1] - layout.cardPos[1]) * u,
              layout.cardPos[2] + (layout.muckPos[2] - layout.cardPos[2]) * u,
            );
            setGroupOpacity(pair, opacity);
          }
          break;
        }

        case 'showdown-reveal': {
          if (anim.seatId === 'hero') {
            break;
          }
          const pair = rivalCardGroups[anim.seatId];
          const local = elapsed - anim.delayMs;
          const u = local <= 0 ? 0 : easeOutCubic(local / anim.durationMs);
          pair.children.forEach((child, i) => {
            child.position.set(
              i === 0 ? -0.145 : 0.145,
              0.025 + i * 0.003 + Math.sin(u * Math.PI) * 0.16,
              0,
            );
            child.rotation.set(0.16 * u, i === 0 ? 0.08 : -0.08, (1 - u) * Math.PI);
          });
          break;
        }

        case 'payout': {
          const local = elapsed - anim.delayMs;
          const u = local <= 0 ? 0 : Math.min(1, local / anim.durationMs);
          const pulse = Math.sin(u * Math.PI);
          for (const winnerId of anim.winnerIds) {
            const layout = SEAT_LAYOUTS[winnerId];
            const ring = seatWinnerRings[winnerId];
            ring.visible = true;
            const scaleBoost = 1 + pulse * 0.14;
            ring.scale.set(
              layout.actorRingScale[0] * 1.08 * scaleBoost,
              1,
              layout.actorRingScale[1] * 1.08 * scaleBoost,
            );
            const mat = ring.material as THREE.MeshStandardMaterial;
            mat.opacity = 0.65 + pulse * 0.35;
          }
          break;
        }

        case 'deal-hand':
        case 'bet-chips':
        case 'street-sweep':
          break;
      }
    }

    return true;
  };

  updateSpot(initialSpot);

  return {
    root,
    updateSpot,
    updateHighlight: applyHighlightState,
    playAnimations,
    stepAnimations,
    snapAnimations,
    hasActiveAnimations: () => activeRun !== null,
  };
}
