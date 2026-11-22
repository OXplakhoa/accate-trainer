import * as THREE from 'three';
import type { LessonHighlight, SceneRival, SceneTableSnapshot } from '../contract';
import { buildChipStacks, CHIP_RADIUS, chipsForAmount, getUnseenHearts, layoutChipColumns, parseCard } from './outs';
import type { ChipCounts } from '../../../engine';
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
}

const CARD_W = 0.31;
const CARD_H = 0.43;
const CARD_THICK = 0.008;
const CHIP_HEIGHT = 0.022;
const BOARD_XS: readonly number[] = [-0.74, -0.36, 0.02, 0.4, 0.78];
const BOARD_Z = -0.22;

function createCardMesh(
  frontTex: THREE.Texture,
  backTex: THREE.Texture,
  options: { readonly ghost?: boolean; readonly opacity?: number } = {},
): THREE.Mesh {
  const ghost = options.ghost ?? false;
  const opacity = options.opacity ?? 1;

  const sideMat = createMatteMaterial(ghost ? 0xf3d4d4 : 0xeee5d5, {
    roughness: 0.9,
    transparent: ghost,
    opacity,
  });
  const frontMat = createMatteMaterial(0xffffff, {
    map: frontTex,
    roughness: ghost ? 0.65 : 0.78,
    metalness: 0.01,
    emissive: ghost ? 0xffe4e6 : 0x000000,
    emissiveIntensity: ghost ? 0.25 : 0,
    transparent: ghost,
    opacity,
  });
  const backMat = createMatteMaterial(0xffffff, {
    map: backTex,
    roughness: 0.82,
    transparent: ghost,
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
  mesh.castShadow = !ghost;
  mesh.receiveShadow = !ghost;
  return mesh;
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
): THREE.Mesh {
  const geo = new THREE.RingGeometry(innerRadius, outerRadius, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = createMatteMaterial(color, {
    roughness: 0.45,
    emissive: color,
    emissiveIntensity: 0.65,
    transparent: true,
    opacity: 0.9,
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
export function createChipPile(chips: ChipCounts): THREE.Group {
  const group = new THREE.Group();
  const stacks = buildChipStacks(chips);
  const offsets = layoutChipColumns(stacks.length);
  const denominations = [...new Set(stacks.map(s => s.denom.value))];
  for (const denomination of denominations) {
    const selected = stacks.filter(s => s.denom.value === denomination);
    const spec = selected[0]!.denom;
    const edge = createChipEdgeTexture(spec.bodyHex, spec.stripeHex);
    const top = createChipTopTexture(spec.bodyHex, spec.stripeHex, spec.accentHex, String(spec.value));
    const mats = [createMatteMaterial(0xffffff, { map: edge }), createMatteMaterial(0xffffff, { map: top })];
    const geometry = new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT, 24);
    const mesh = new THREE.InstancedMesh(geometry, [mats[0]!, mats[1]!, mats[1]!], selected.reduce((n, s) => n + s.count, 0));
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
  return group;
}

export function buildTabletop(initialSpot: SceneTableSnapshot): TabletopRig {
  const root = new THREE.Group();
  root.name = 'Tabletop';

  const cardBackTex = createCardBackTexture();

  // Static face-down rival hole cards (never revealed at the 3D layer; hidden when seat is unoccupied or between hands)
  const rivalCardPlacements: readonly {
    readonly id: SceneRival;
    readonly x: number;
    readonly z: number;
    readonly rotY: number;
  }[] = [
    // Cá (left-far)
    { id: 'ca', x: -1.18, z: -0.68, rotY: 0.92 },
    // Cáo (center-far)
    { id: 'cao', x: 0.0, z: -0.96, rotY: 0.0 },
    // Nóng (right-far)
    { id: 'nong', x: 1.18, z: -0.68, rotY: -0.92 },
  ];

  const rivalCardGroups: Record<SceneRival, THREE.Group> = {
    ca: new THREE.Group(),
    cao: new THREE.Group(),
    nong: new THREE.Group(),
  };

  const rivalTurnRings: Record<SceneRival, THREE.Mesh> = {
    ca: createHighlightRing(0.22, 0.27, SCENE_COLORS.highlightPot, 1.18, 0.88),
    cao: createHighlightRing(0.22, 0.27, SCENE_COLORS.highlightPot, 1.18, 0.88),
    nong: createHighlightRing(0.22, 0.27, SCENE_COLORS.highlightPot, 1.18, 0.88),
  };

  for (const place of rivalCardPlacements) {
    const pair = rivalCardGroups[place.id];
    pair.position.set(place.x, 0.005, place.z);
    pair.rotation.y = place.rotY;

    for (let i = 0; i < 2; i += 1) {
      const card = createCardMesh(cardBackTex, cardBackTex);
      card.scale.set(0.76, 1, 0.76);
      card.position.set(i === 0 ? -0.075 : 0.075, i * 0.003, i === 0 ? 0.01 : -0.01);
      card.rotation.y = i === 0 ? 0.14 : -0.14;
      pair.add(card);
    }
    root.add(pair);

    const turnRing = rivalTurnRings[place.id];
    turnRing.position.set(place.x, 0.0055, place.z);
    turnRing.rotation.y = place.rotY;
    root.add(turnRing);
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
    { x: -1.38, z: -0.42, body: '#4F9DD3', stripe: '#F7EFE2', accent: '#D8ECFA', label: '10', count: 5 },
    { x: -1.24, z: -0.34, body: '#2E6A5E', stripe: '#F3E8D4', accent: '#A7D3C7', label: '25', count: 3 },
    // Cáo
    { x: 0.42, z: -0.95, body: '#E18A46', stripe: '#F7EFE2', accent: '#F7E7CA', label: '25', count: 6 },
    { x: 0.56, z: -0.88, body: '#C95849', stripe: '#F5EAD8', accent: '#E9C890', label: '50', count: 3 },
    // Nóng
    { x: 1.38, z: -0.42, body: '#C95849', stripe: '#F5EAD8', accent: '#E9C890', label: '50', count: 5 },
    { x: 1.24, z: -0.34, body: '#D89A46', stripe: '#533C31', accent: '#F7E7CA', label: '5', count: 4 },
    // Hero personal reserve stack (left side of Hero)
    { x: -0.78, z: 0.86, body: '#2E6A5E', stripe: '#F3E8D4', accent: '#A7D3C7', label: '25', count: 5 },
    { x: -0.63, z: 0.92, body: '#4F9DD3', stripe: '#F7EFE2', accent: '#D8ECFA', label: '10', count: 6 },
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
  dealerBtn.position.set(-0.88, 0.013, -0.58);
  dealerBtn.castShadow = true;
  fixtureSeatPropsGroup.add(dealerBtn);
  root.add(fixtureSeatPropsGroup);

  // Subtle empty River slot marker on the felt (5th board card position: BOARD_XS[4] = 0.78)
  const riverSlotX = BOARD_XS[4] ?? 0.78;
  const riverSlotZ = BOARD_Z;
  const riverSlotTex = createRiverSlotTexture();
  const riverSlot = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_W, CARD_H),
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

  // --- Highlight Rings & Visual Indicators ---
  // 1. Pot center halo (surrounds the existing pot chips at center-left)
  const potRing = createHighlightRing(0.35, 0.41, SCENE_COLORS.highlightPot, 1.24, 0.96);
  potRing.position.set(-0.08, 0.006, 0.28);
  root.add(potRing);

  // 2. Hero Call zone halo (surrounds the call chips in front of Hero)
  const callRing = createHighlightRing(0.22, 0.275, SCENE_COLORS.highlightCall, 1.15, 1.0);
  callRing.position.set(0.62, 0.006, 0.62);
  root.add(callRing);

  // 3. Total pot after call unified halo (encompasses BOTH Pot + Call together)
  const totalRing = createHighlightRing(0.76, 0.83, SCENE_COLORS.highlightTotal, 1.22, 0.74);
  totalRing.position.set(0.24, 0.0055, 0.44);
  totalRing.rotation.y = -0.34;
  root.add(totalRing);

  // 4. River Outs halo under the open River slot
  const riverOutsRing = createHighlightRing(0.22, 0.27, SCENE_COLORS.highlightOuts, 0.95, 1.22);
  riverOutsRing.position.set(riverSlotX, 0.006, riverSlotZ);
  root.add(riverOutsRing);

  // Dynamic groups rebuilt when spot cards/amounts change
  const boardGroup = new THREE.Group();
  root.add(boardGroup);

  const heroCardsGroup = new THREE.Group();
  root.add(heroCardsGroup);

  const potChipsGroup = new THREE.Group();
  potChipsGroup.position.set(-0.08, 0, 0.28);
  root.add(potChipsGroup);

  const callChipsGroup = new THREE.Group();
  callChipsGroup.position.set(0.62, 0, 0.62);
  root.add(callChipsGroup);

  const outsFanGroup = new THREE.Group();
  outsFanGroup.position.set(riverSlotX, 0.24, riverSlotZ - 0.02);
  outsFanGroup.visible = false;
  root.add(outsFanGroup);

  let seenHeartFrames: THREE.Mesh[] = [];
  let currentHighlight: LessonHighlight = null;
  let currentSpot: SceneTableSnapshot = initialSpot;
  let currentCardsAndChipsKey = '';

  const sharedTextures = new Set<THREE.Texture>([cardBackTex]);

  const clearGroup = (group: THREE.Group) => {
    for (const child of [...group.children]) {
      disposeObject3DResources(child, sharedTextures);
      group.remove(child);
    }
  };

  const applyHighlightState = (highlight: LessonHighlight) => {
    currentHighlight = highlight;
    const effective = getEffectiveHighlight(currentSpot, highlight);
    const showOuts = shouldShowOuts(currentSpot, highlight);

    potRing.visible = (effective === 'pot' || effective === 'total') && currentSpot.pot > 0;
    callRing.visible = (effective === 'call' || effective === 'total') && currentSpot.call > 0;
    totalRing.visible = effective === 'total';
    riverOutsRing.visible = showOuts;
    outsFanGroup.visible = showOuts;

    // Subtle elevation lift on highlighted chip clusters for instant tactile feedback
    potChipsGroup.position.y = effective === 'pot' || effective === 'total' ? 0.032 : 0;
    callChipsGroup.position.y = effective === 'call' || effective === 'total' ? 0.036 : 0;

    // Emphasize the seen heart cards slightly when showing the flush draw outs in Drill mode
    for (const frame of seenHeartFrames) {
      frame.visible = showOuts;
    }
  };

  const updateSpot = (spot: SceneTableSnapshot) => {
    currentSpot = spot;
    const isLive = isLiveSnapshot(spot);
    const occupiedSet = new Set<SceneRival>(getOccupiedRivals(spot));

    // Toggle seat props, rival face-down cards, turn indicator, and River placeholder cheaply
    fixtureSeatPropsGroup.visible = !isLive;
    riverSlot.visible = shouldShowRiverPlaceholder(spot);

    for (const rival of ALL_SCENE_RIVALS) {
      rivalCardGroups[rival].visible = isRivalCardsVisible(spot, rival);
      rivalTurnRings[rival].visible =
        isLive && spot.live?.activeRival === rival && occupiedSet.has(rival);
    }

    const cardsAndChipsKey = `${isLive ? 'L' : 'D'}:${spot.pot}:${JSON.stringify(spot.live?.potChips)}:${spot.call}:${spot.heroCards.join(',')}:${spot.board.join(',')}`;
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
    seenHeartFrames = [];

    // 1. Community Cards (0-5 cards; index 4 occupies the exact River slot at x = 0.78)
    spot.board.slice(0, 5).forEach((cardStr, idx) => {
      const bx = BOARD_XS[idx] ?? riverSlotX;
      const faceTex = createCardFaceTexture(cardStr);
      const cardMesh = createCardMesh(faceTex, cardBackTex);
      cardMesh.position.set(bx, 0.008, BOARD_Z);
      boardGroup.add(cardMesh);

      if (!isLive && parseCard(cardStr).isHeart) {
        const frame = createHeartOutlineFrame();
        frame.position.set(bx, 0.005, BOARD_Z);
        boardGroup.add(frame);
        seenHeartFrames.push(frame);
      }
    });

    // 2. Hero Hole Cards (0-2 cards; empty when Hero has no cards between hands or when absent)
    const heroOffsets: readonly { x: number; z: number; rotY: number }[] = [
      { x: -0.18, z: 0.88, rotY: 0.07 },
      { x: 0.18, z: 0.88, rotY: -0.07 },
    ];
    spot.heroCards.slice(0, 2).forEach((cardStr, idx) => {
      const offset = heroOffsets[idx] ?? { x: 0, z: 0.88, rotY: 0 };
      const faceTex = createCardFaceTexture(cardStr);
      const cardHolder = new THREE.Group();
      cardHolder.position.set(offset.x, 0.11, offset.z);
      cardHolder.rotation.y = offset.rotY;
      // Tilted upward so Hero's cards read effortlessly at arrival, decision, and review
      cardHolder.rotation.x = 0.52;

      const cardMesh = createCardMesh(faceTex, cardBackTex);
      cardMesh.scale.set(1.06, 1, 1.06);
      cardHolder.add(cardMesh);

      if (!isLive && parseCard(cardStr).isHeart) {
        const frame = createHeartOutlineFrame();
        frame.scale.set(1.08, 1, 1.08);
        frame.position.y = -0.004;
        cardHolder.add(frame);
        seenHeartFrames.push(frame);
      }

      heroCardsGroup.add(cardHolder);
    });

    // Real pot counts in live mode; hypothetical amounts in Drill and Call.
    potChipsGroup.add(createChipPile(spot.live?.potChips ?? chipsForAmount(spot.pot)));
    callChipsGroup.add(createChipPile(chipsForAmount(spot.call)));

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

  updateSpot(initialSpot);

  return {
    root,
    updateSpot,
    updateHighlight: applyHighlightState,
  };
}
