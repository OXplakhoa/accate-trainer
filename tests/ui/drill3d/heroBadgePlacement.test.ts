import type * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHIP_SET, emptyChips, initialDistribution, type ChipCounts } from '../../../src/engine';
import type { SceneTableSnapshot } from '../../../src/ui/drill3d/contract';
import { CHIP_RADIUS } from '../../../src/ui/drill3d/scene/outs';
import type { PublicTableSeat, TableSeatId } from '../../../src/ui/sandbox/types';

vi.mock('../../../src/ui/drill3d/scene/textures', async () => {
  const three = await import('three');
  const makeTex = (name: string) => {
    const tex = new three.Texture();
    tex.name = name;
    return tex;
  };
  return {
    createCardBackTexture: () => makeTex('card-back'),
    createCardFaceTexture: (card: string) => makeTex(`card-face:${card}`),
    createChipEdgeTexture: () => makeTex('chip-edge'),
    createChipTopTexture: (_b: string, _s: string, _a: string, label: string) =>
      makeTex(`chip:${label}`),
    createRiverSlotTexture: () => makeTex('river-slot'),
  };
});

vi.mock('../../../src/ui/drill3d/scene/actionBubble', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../src/ui/drill3d/scene/actionBubble')
  >();
  const three = await import('three');
  return {
    ...actual,
    createActionBubbleTexture: (spec: { label: string; tone: string }) => {
      const tex = new three.Texture();
      tex.name = `bubble:${spec.label}`;
      return tex;
    },
  };
});

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface ScreenRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

interface ViewportSpec {
  readonly windowLabel: string;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly hudBoardDock: ScreenRect;
  readonly hudHeroDock: ScreenRect;
}

/**
 * Actual .drill3d-stage / .drill3d-canvas CSS pixel dimensions and bottom HUD dock rects
 * ("Bài chung (River)" with 5 board cards, "Bài Hero" with 2 hole cards) measured in the
 * running Sandbox 3D app (/sandbox-3d.html?seed=sandbox3d-0, on River) via Playwright using
 * element.getBoundingClientRect() relative to .drill3d-canvas:
 * - 1440x900 window -> 999x678 canvas (desktop grid + max-height: 680px - 2px border)
 *   - Bài chung (River): x [12, 216], y [592.05, 668]
 *   - Bài Hero:          x [889, 987], y [588.05, 668]
 * - 390x844 window  -> 370x308 canvas (@media max-width: 480px, aspect-ratio: 6/5, min-height: 310px - 2px border)
 *   - Bài chung (River): x [8, 178], y [235.09, 300]
 *   - Bài Hero:          x [282, 362], y [232.09, 300]
 * - 320x700 window  -> 306x306 canvas (@media max-width: 350px, aspect-ratio: 1/1 - 2px border)
 *   - Bài chung (River): x [6, 157], y [238.09, 300]
 *   - Bài Hero:          x [229, 300], y [236.09, 300]
 */
const CANVAS_VIEWPORTS: readonly ViewportSpec[] = [
  {
    windowLabel: '1440x900',
    canvasWidth: 999,
    canvasHeight: 678,
    hudBoardDock: { minX: 12, maxX: 216, minY: 592.05, maxY: 668 },
    hudHeroDock: { minX: 889, maxX: 987, minY: 588.05, maxY: 668 },
  },
  {
    windowLabel: '390x844',
    canvasWidth: 370,
    canvasHeight: 308,
    hudBoardDock: { minX: 8, maxX: 178, minY: 235.09, maxY: 300 },
    hudHeroDock: { minX: 282, maxX: 362, minY: 232.09, maxY: 300 },
  },
  {
    windowLabel: '320x700',
    canvasWidth: 306,
    canvasHeight: 306,
    hudBoardDock: { minX: 6, maxX: 157, minY: 238.09, maxY: 300 },
    hudHeroDock: { minX: 229, maxX: 300, minY: 236.09, maxY: 300 },
  },
];

const MIN_CLEARANCE_PX = 4;

// Chip-stack bounding box dimensions derived from CHIP_RADIUS (0.072), column spacing (0.16),
// CHIP_HEIGHT (0.022), and maxPerColumn (10 -> 0.22 tall for pot/call/bet).
const CHIP_STACK_HEIGHT = 0.022 * 10;
const POT_PILE_HALF_EXTENTS = {
  x: 0.32 + CHIP_RADIUS,
  y: CHIP_STACK_HEIGHT / 2,
  z: 0.08 + CHIP_RADIUS,
};
const CALL_PILE_HALF_EXTENTS = {
  x: 0.16 + CHIP_RADIUS,
  y: CHIP_STACK_HEIGHT / 2,
  z: 0.08 + CHIP_RADIUS,
};
const HERO_BET_SCALE = 0.88;
const HERO_BET_HALF_EXTENTS = {
  x: (0.16 + CHIP_RADIUS) * HERO_BET_SCALE,
  y: (CHIP_STACK_HEIGHT * HERO_BET_SCALE) / 2,
  z: (0.08 + CHIP_RADIUS) * HERO_BET_SCALE,
};

// Seat stack builder uses createChipPile(chips, { maxPerColumn: 16, scale: 0.76 }).
const SEAT_STACK_MAX_PER_COLUMN = 16;
const SEAT_STACK_SCALE = 0.76;

function projectToScreen(
  worldPoint: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  const ndc = worldPoint.clone().project(camera);
  return {
    x: (ndc.x * 0.5 + 0.5) * width,
    y: (-ndc.y * 0.5 + 0.5) * height,
  };
}

function rectFromPoints(points: readonly { readonly x: number; readonly y: number }[]): ScreenRect {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Signed Euclidean clearance between two axis-aligned screen rectangles:
 * positive when separated, zero when touching, negative when overlapping.
 */
function rectGapPx(a: ScreenRect, b: ScreenRect): number {
  const dx = Math.max(a.minX - b.maxX, b.minX - a.maxX);
  const dy = Math.max(a.minY - b.maxY, b.minY - a.maxY);
  if (dx >= 0 && dy >= 0) {
    return Math.hypot(dx, dy);
  }
  if (dx >= 0) {
    return dx;
  }
  if (dy >= 0) {
    return dy;
  }
  return Math.max(dx, dy);
}

function makeChips(partial: Partial<ChipCounts> = {}): ChipCounts {
  return { ...emptyChips(), ...partial };
}

function makeSeatWithAction(
  id: TableSeatId,
  actionType: 'check' | 'call' | 'bet',
  amount: number,
): PublicTableSeat {
  return {
    id,
    stackChips: initialDistribution(4).perPlayer,
    streetChips:
      amount > 0 ? makeChips({ 10: Math.max(1, Math.floor(amount / 10)) }) : emptyChips(),
    status: 'active',
    lastAction: { type: actionType, amount },
    isActor: false,
    isWinner: false,
    revealedCards: id === 'hero' ? ['7♥', '10♥'] : null,
  };
}

function makeRiverLiveSpot(): SceneTableSnapshot {
  return {
    pot: 120,
    call: 20,
    heroCards: ['7♥', '10♥'],
    board: ['10♣', '3♥', '6♣', '2♥', 'Q♠'],
    live: {
      potChips: makeChips({ 5: 4, 10: 5, 50: 1 }),
      handNumber: 1,
      timelineLength: 14,
      street: 'river',
      occupiedRivals: ['ca', 'cao', 'nong'],
      activeRival: null,
      activePlayerName: null,
      payoutTransfers: [],
      seats: [
        makeSeatWithAction('hero', 'check', 0),
        makeSeatWithAction('ca', 'check', 0),
        makeSeatWithAction('cao', 'check', 0),
        makeSeatWithAction('nong', 'check', 0),
      ],
    },
  };
}

describe('Hero and rival action badge screen-space placement (decision camera)', () => {
  it('keeps Hero badge clear of board, Hero cards, pot/call/bet, Hero chip stack, hands/forearms, HUD dock, and canvas edges', async () => {
    const three = await import('three');
    const {
      ACTION_BUBBLE_SCALE,
      buildTabletop,
      createChipPile,
      SEAT_LAYOUTS,
      TABLETOP_METRICS,
    } = await import('../../../src/ui/drill3d/scene/buildTabletop');
    const { HERO_ACTION_BUBBLE_CANVAS } = await import(
      '../../../src/ui/drill3d/scene/actionBubble'
    );
    const { buildCharacters } = await import(
      '../../../src/ui/drill3d/scene/buildCharacters'
    );
    const { CAMERA_PRESETS, computeAdaptiveFov } = await import(
      '../../../src/ui/drill3d/scene/sceneController'
    );

    const makeDecisionCamera = (width: number, height: number): THREE.PerspectiveCamera => {
      const preset = CAMERA_PRESETS.decision;
      const aspect = width / height;
      const fov = computeAdaptiveFov(preset.baseFov, preset.minHFov, aspect);
      const camera = new three.PerspectiveCamera(fov, aspect, 0.1, 32);
      camera.position.set(preset.position[0], preset.position[1], preset.position[2]);
      camera.lookAt(preset.target[0], preset.target[1], preset.target[2]);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      return camera;
    };

    const projectSpriteBillboard = (
      sprite: THREE.Sprite,
      camera: THREE.PerspectiveCamera,
      width: number,
      height: number,
    ): ScreenRect => {
      const camRight = new three.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const camUp = new three.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const center = sprite.getWorldPosition(new three.Vector3());
      const halfW = sprite.scale.x / 2;
      const halfH = sprite.scale.y / 2;

      const corners = [
        center.clone().addScaledVector(camRight, -halfW).addScaledVector(camUp, -halfH),
        center.clone().addScaledVector(camRight, halfW).addScaledVector(camUp, -halfH),
        center.clone().addScaledVector(camRight, halfW).addScaledVector(camUp, halfH),
        center.clone().addScaledVector(camRight, -halfW).addScaledVector(camUp, halfH),
      ];

      return rectFromPoints(corners.map((corner) => projectToScreen(corner, camera, width, height)));
    };

    const projectObjectGeometry = (
      object: THREE.Object3D,
      camera: THREE.PerspectiveCamera,
      width: number,
      height: number,
    ): ScreenRect => {
      const points: { readonly x: number; readonly y: number }[] = [];
      const vertex = new three.Vector3();

      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) {
          return;
        }
        const pos = mesh.geometry.attributes.position;
        if (!pos) {
          return;
        }
        for (let i = 0; i < pos.count; i += 1) {
          vertex.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          points.push(projectToScreen(vertex, camera, width, height));
        }
      });

      expect(points.length).toBeGreaterThan(0);
      return rectFromPoints(points);
    };

    const projectBox3Corners = (
      box: THREE.Box3,
      camera: THREE.PerspectiveCamera,
      width: number,
      height: number,
    ): ScreenRect => {
      const points: { readonly x: number; readonly y: number }[] = [];
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            points.push(projectToScreen(new three.Vector3(x, y, z), camera, width, height));
          }
        }
      }
      return rectFromPoints(points);
    };

    const projectWorldBox = (
      centerX: number,
      centerY: number,
      centerZ: number,
      halfExtents: { readonly x: number; readonly y: number; readonly z: number },
      camera: THREE.PerspectiveCamera,
      width: number,
      height: number,
    ): ScreenRect =>
      projectBox3Corners(
        new three.Box3(
          new three.Vector3(
            centerX - halfExtents.x,
            centerY - halfExtents.y,
            centerZ - halfExtents.z,
          ),
          new three.Vector3(
            centerX + halfExtents.x,
            centerY + halfExtents.y,
            centerZ + halfExtents.z,
          ),
        ),
        camera,
        width,
        height,
      );

    const rig = buildTabletop(makeRiverLiveSpot());
    rig.root.updateMatrixWorld(true);

    const heroBubble = rig.root.getObjectByName('SeatBubble-hero') as THREE.Sprite;
    expect(heroBubble).toBeDefined();
    expect(heroBubble.scale.y).toBeGreaterThanOrEqual(ACTION_BUBBLE_SCALE.y * 0.85);
    expect(heroBubble.scale.x / heroBubble.scale.y).toBeCloseTo(
      HERO_ACTION_BUBBLE_CANVAS.width / HERO_ACTION_BUBBLE_CANVAS.height,
      2,
    );

    // Hero badge must read as Hero's: on the near (Hero) half of the table and closer
    // to Hero's cards than any rival badge.
    expect(heroBubble.position.z).toBeGreaterThan(0);
    const heroCardsPos = SEAT_LAYOUTS.hero.cardPos;
    const heroBubbleDist = Math.hypot(
      heroBubble.position.x - heroCardsPos[0],
      heroBubble.position.z - heroCardsPos[2],
    );
    for (const seatId of ['ca', 'cao', 'nong'] as const) {
      const rivalPos = SEAT_LAYOUTS[seatId].bubblePos;
      const rivalDist = Math.hypot(
        rivalPos[0] - heroCardsPos[0],
        rivalPos[2] - heroCardsPos[2],
      );
      expect(heroBubbleDist).toBeLessThan(rivalDist);
    }

    const boardHolders = [0, 1, 2, 3, 4].map((idx) => {
      const holder = rig.root.getObjectByName(`BoardCard-${idx}`);
      expect(holder, `BoardCard-${idx} must exist`).toBeDefined();
      return holder!;
    });

    const heroCardsGroup = rig.root.getObjectByName('HeroCards');
    expect(heroCardsGroup).toBeDefined();
    expect(heroCardsGroup!.children).toHaveLength(2);

    // Real Hero chip stack bounding boxes at SEAT_LAYOUTS.hero.stackPos:
    // - full 500-point 4-player starting stack (5 cols x 1 row, up to 16 chips high, scale 0.76)
    // - largest stack the entire 6,500-point CHIP_SET allows (20 cols = 4 rows x 5 cols, 16 high, scale 0.76)
    const heroStack500 = createChipPile(initialDistribution(4).perPlayer, {
      maxPerColumn: SEAT_STACK_MAX_PER_COLUMN,
      scale: SEAT_STACK_SCALE,
    });
    heroStack500.position.set(SEAT_LAYOUTS.hero.stackPos[0], 0, SEAT_LAYOUTS.hero.stackPos[1]);
    heroStack500.updateMatrixWorld(true);
    const heroStack500Box = new three.Box3().setFromObject(heroStack500);

    const heroStackMax = createChipPile(CHIP_SET, {
      maxPerColumn: SEAT_STACK_MAX_PER_COLUMN,
      scale: SEAT_STACK_SCALE,
    });
    heroStackMax.position.set(SEAT_LAYOUTS.hero.stackPos[0], 0, SEAT_LAYOUTS.hero.stackPos[1]);
    heroStackMax.updateMatrixWorld(true);
    const heroStackMaxBox = new three.Box3().setFromObject(heroStackMax);
    expect(heroStackMaxBox.max.y).toBeCloseTo(SEAT_STACK_MAX_PER_COLUMN * 0.022 * SEAT_STACK_SCALE, 3);
    expect(heroStackMaxBox.containsBox(heroStack500Box)).toBe(true);

    // Real Hero hands and forearms from buildCharacters.ts
    const characters = buildCharacters();
    characters.root.updateMatrixWorld(true);
    const heroArmLeft = characters.root.getObjectByName('HeroArmLeft');
    const heroArmRight = characters.root.getObjectByName('HeroArmRight');
    expect(heroArmLeft).toBeDefined();
    expect(heroArmRight).toBeDefined();
    const heroArmLeftBox = new three.Box3().setFromObject(heroArmLeft!);
    const heroArmRightBox = new three.Box3().setFromObject(heroArmRight!);

    const rivalBubbles = (['ca', 'cao', 'nong'] as const).map((seatId) => {
      const sprite = rig.root.getObjectByName(`SeatBubble-${seatId}`) as THREE.Sprite;
      expect(sprite, `SeatBubble-${seatId} must exist`).toBeDefined();
      return { seatId, sprite };
    });

    for (const vp of CANVAS_VIEWPORTS) {
      const camera = makeDecisionCamera(vp.canvasWidth, vp.canvasHeight);
      const heroRect = projectSpriteBillboard(heroBubble, camera, vp.canvasWidth, vp.canvasHeight);

      // 1. Hero badge stays fully inside the canvas
      expect(
        heroRect.minX,
        `${vp.windowLabel}: Hero badge left edge clipped (${heroRect.minX.toFixed(1)}px)`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        heroRect.maxX,
        `${vp.windowLabel}: Hero badge right edge clipped (${heroRect.maxX.toFixed(1)}px > ${vp.canvasWidth}px)`,
      ).toBeLessThanOrEqual(vp.canvasWidth);
      expect(
        heroRect.minY,
        `${vp.windowLabel}: Hero badge top edge clipped (${heroRect.minY.toFixed(1)}px)`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        heroRect.maxY,
        `${vp.windowLabel}: Hero badge bottom edge clipped (${heroRect.maxY.toFixed(1)}px > ${vp.canvasHeight}px)`,
      ).toBeLessThanOrEqual(vp.canvasHeight);

      // 2. Project all 5 board cards (including River) and both Hero hole cards from real geometry
      const boardRects = boardHolders.map((holder, idx) => ({
        label: `BoardCard-${idx}`,
        rect: projectObjectGeometry(holder, camera, vp.canvasWidth, vp.canvasHeight),
      }));
      const heroCardRects = heroCardsGroup!.children.map((card, idx) => ({
        label: `HeroCard-${idx}`,
        rect: projectObjectGeometry(card, camera, vp.canvasWidth, vp.canvasHeight),
      }));

      // 3. Project pot pile, call pile, Hero's bet pile, and Hero's personal chip stack
      const chipRects = [
        {
          label: 'PotPile',
          rect: projectWorldBox(
            TABLETOP_METRICS.potPos.x,
            POT_PILE_HALF_EXTENTS.y,
            TABLETOP_METRICS.potPos.z,
            POT_PILE_HALF_EXTENTS,
            camera,
            vp.canvasWidth,
            vp.canvasHeight,
          ),
        },
        {
          label: 'CallPile',
          rect: projectWorldBox(
            TABLETOP_METRICS.callPos.x,
            CALL_PILE_HALF_EXTENTS.y,
            TABLETOP_METRICS.callPos.z,
            CALL_PILE_HALF_EXTENTS,
            camera,
            vp.canvasWidth,
            vp.canvasHeight,
          ),
        },
        {
          label: 'HeroBetPile',
          rect: projectWorldBox(
            SEAT_LAYOUTS.hero.betPos[0],
            HERO_BET_HALF_EXTENTS.y,
            SEAT_LAYOUTS.hero.betPos[1],
            HERO_BET_HALF_EXTENTS,
            camera,
            vp.canvasWidth,
            vp.canvasHeight,
          ),
        },
        {
          label: 'HeroStackPile',
          rect: projectBox3Corners(heroStackMaxBox, camera, vp.canvasWidth, vp.canvasHeight),
        },
      ];

      // 4. Project Hero's real hands & forearms bounding-box corners
      const handRects = [
        {
          label: 'HeroArmLeft',
          rect: projectBox3Corners(heroArmLeftBox, camera, vp.canvasWidth, vp.canvasHeight),
        },
        {
          label: 'HeroArmRight',
          rect: projectBox3Corners(heroArmRightBox, camera, vp.canvasWidth, vp.canvasHeight),
        },
      ];

      // 5. Bottom HUD dock overlays ("Bài chung", "Bài Hero")
      const hudRects = [
        { label: 'HudBoardDock', rect: vp.hudBoardDock },
        { label: 'HudHeroDock', rect: vp.hudHeroDock },
      ];

      for (const obstacle of [
        ...boardRects,
        ...heroCardRects,
        ...chipRects,
        ...handRects,
        ...hudRects,
      ]) {
        const gap = rectGapPx(heroRect, obstacle.rect);
        expect(
          gap,
          `${vp.windowLabel} (${vp.canvasWidth}x${vp.canvasHeight}): Hero badge gap to ${obstacle.label} is ${gap.toFixed(1)}px (need >= ${MIN_CLEARANCE_PX}px)`,
        ).toBeGreaterThanOrEqual(MIN_CLEARANCE_PX);
      }

      // 6. Rival badges must not touch any board card slot or Hero's hole cards
      for (const { seatId, sprite } of rivalBubbles) {
        const rivalRect = projectSpriteBillboard(sprite, camera, vp.canvasWidth, vp.canvasHeight);
        for (const obstacle of [...boardRects, ...heroCardRects]) {
          const gap = rectGapPx(rivalRect, obstacle.rect);
          expect(
            gap,
            `${vp.windowLabel} (${vp.canvasWidth}x${vp.canvasHeight}): Rival ${seatId} badge gap to ${obstacle.label} is ${gap.toFixed(1)}px (need >= ${MIN_CLEARANCE_PX}px)`,
          ).toBeGreaterThanOrEqual(MIN_CLEARANCE_PX);
        }
      }
    }
  });
});
