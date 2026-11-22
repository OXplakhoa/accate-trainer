import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FillTextCall {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly font: string;
  readonly fillStyle: string;
}

interface ArcCall {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

function createCanvasMock(fillTextCalls: FillTextCall[] = [], arcCalls: ArcCall[] = []) {
  const mockCtx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textAlign: 'left',
    textBaseline: 'top',
    globalAlpha: 1,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arc: vi.fn((x: number, y: number, r: number) => {
      arcCalls.push({ x, y, r });
    }),
    ellipse: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    clip: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    fillText: vi.fn(function (
      this: { font: string; fillStyle: string },
      text: string,
      x: number,
      y: number,
    ) {
      fillTextCalls.push({ text, x, y, font: this.font, fillStyle: this.fillStyle });
    }),
  };

  const createdCanvases: { width: number; height: number }[] = [];
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => mockCtx,
        };
        createdCanvases.push(canvas);
        return canvas;
      }
      return {};
    },
  });

  return { mockCtx, createdCanvases };
}

describe('L2 3D look and lighting polish', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    createCanvasMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps Hero forearms, cuffs and hands strictly above the rail top and non-intersecting with the rail', async () => {
    const THREE = await import('three');
    const { buildRoomAndTable, TABLE_METRICS } = await import(
      '../../../src/ui/drill3d/scene/buildRoomAndTable'
    );
    const { buildCharacters } = await import('../../../src/ui/drill3d/scene/buildCharacters');

    const room = buildRoomAndTable();
    room.updateMatrixWorld(true);

    const railMesh = room.getObjectByName('TableRail');
    expect(railMesh).toBeDefined();
    const railBox = new THREE.Box3().setFromObject(railMesh!);
    // Rail top plateau is at position.y (0.072) + bevelThickness (0.045) = 0.117
    expect(railBox.max.y).toBeCloseTo(0.117, 3);

    const characters = buildCharacters();
    characters.root.updateMatrixWorld(true);

    const hero = characters.root.getObjectByName('HeroPresence');
    expect(hero).toBeDefined();

    const heroBox = new THREE.Box3().setFromObject(hero!);
    expect(heroBox.min.y).toBeGreaterThan(railBox.max.y);

    const meshNames: string[] = [];
    hero!.traverse((obj) => {
      const mesh = obj as import('three').Mesh;
      if (!mesh.isMesh) {
        return;
      }
      meshNames.push(mesh.name);
      const box = new THREE.Box3().setFromObject(mesh);
      // Every sleeve, cuff, wrist, palm, finger and thumb mesh sits above railBox.max.y
      expect(box.min.y).toBeGreaterThan(railBox.max.y);

      // Verify horizontal position rests over the near rail ring and never covers hole cards, pot, call or board
      const center = box.getCenter(new THREE.Vector3());
      expect(center.z).toBeGreaterThan(1.1);
      expect(Math.abs(center.x)).toBeGreaterThan(0.38);

      const normOuter = Math.hypot(
        center.x / (TABLE_METRICS.railOuterRx + 0.06),
        center.z / (TABLE_METRICS.railOuterRz + 0.06),
      );
      const normInner = Math.hypot(
        center.x / (TABLE_METRICS.feltRx - 0.12),
        center.z / (TABLE_METRICS.feltRz - 0.12),
      );
      expect(normOuter).toBeLessThanOrEqual(1.0);
      expect(normInner).toBeGreaterThanOrEqual(0.95);
    });

    // Both left and right arms have sleeve, cuff, wrist, palm, 4 fingers, and thumb (9 meshes * 2 = 18)
    expect(meshNames).toHaveLength(18);
    expect(meshNames.filter((n) => n === 'HeroSleeve')).toHaveLength(2);
    expect(meshNames.filter((n) => n === 'HeroCuff')).toHaveLength(2);
    expect(meshNames.filter((n) => n === 'HeroPalm')).toHaveLength(2);
  });

  it('gives Cá, Cáo and Nóng distinct hand colours resting on the rail that stay planted when leaning', async () => {
    const THREE = await import('three');
    const { buildRoomAndTable } = await import('../../../src/ui/drill3d/scene/buildRoomAndTable');
    const { buildCharacters, PHASE_CHARACTER_POSES } = await import(
      '../../../src/ui/drill3d/scene/buildCharacters'
    );
    const { SCENE_COLORS } = await import('../../../src/ui/drill3d/scene/palette');

    const room = buildRoomAndTable();
    room.updateMatrixWorld(true);
    const railBox = new THREE.Box3().setFromObject(room.getObjectByName('TableRail')!);

    const characters = buildCharacters();
    characters.applyPose(PHASE_CHARACTER_POSES.decision);
    characters.root.updateMatrixWorld(true);

    // Distinct hand colors vs sleeve colors
    expect(SCENE_COLORS.caHand).not.toBe(SCENE_COLORS.caShirt);
    expect(SCENE_COLORS.caHand).not.toBe(SCENE_COLORS.caBlue);
    expect(SCENE_COLORS.caoPaw).not.toBe(SCENE_COLORS.caoJacket);
    expect(SCENE_COLORS.caoPaw).not.toBe(SCENE_COLORS.caoCream);
    expect(SCENE_COLORS.nongHand).not.toBe(SCENE_COLORS.nongSweater);

    for (const rivalName of ['CharacterCa', 'CharacterCao', 'CharacterNong']) {
      characters.applyPose(PHASE_CHARACTER_POSES.decision);
      characters.root.updateMatrixWorld(true);

      const rival = characters.root.getObjectByName(rivalName);
      expect(rival).toBeDefined();

      const handL = rival!.getObjectByName('RivalHandLeft')!;
      const handR = rival!.getObjectByName('RivalHandRight')!;
      expect(handL).toBeDefined();
      expect(handR).toBeDefined();

      const boxL = new THREE.Box3().setFromObject(handL);
      const boxR = new THREE.Box3().setFromObject(handR);
      expect(boxL.min.y).toBeGreaterThan(railBox.max.y);
      expect(boxR.min.y).toBeGreaterThan(railBox.max.y);

      const beforeL = handL.getWorldPosition(new THREE.Vector3());
      const beforeR = handR.getWorldPosition(new THREE.Vector3());

      characters.applyPose({
        ...PHASE_CHARACTER_POSES.decision,
        caLean: 0.11,
        caoLean: 0.11,
        nongLean: 0.11,
      });
      characters.root.updateMatrixWorld(true);

      const leanedBoxL = new THREE.Box3().setFromObject(handL);
      const leanedBoxR = new THREE.Box3().setFromObject(handR);
      expect(leanedBoxL.min.y).toBeGreaterThan(railBox.max.y);
      expect(leanedBoxR.min.y).toBeGreaterThan(railBox.max.y);

      const afterL = handL.getWorldPosition(new THREE.Vector3());
      const afterR = handR.getWorldPosition(new THREE.Vector3());

      expect(beforeL.distanceTo(afterL)).toBeLessThan(0.015);
      expect(beforeR.distanceTo(afterR)).toBeLessThan(0.015);
    }
  });

  it('adds Vietnamese home-game room props completely clear of table sightlines from all cameras', async () => {
    const THREE = await import('three');
    const { buildRoomAndTable, TABLE_METRICS } = await import(
      '../../../src/ui/drill3d/scene/buildRoomAndTable'
    );
    const { buildCharacters } = await import('../../../src/ui/drill3d/scene/buildCharacters');
    const { CAMERA_PRESETS } = await import('../../../src/ui/drill3d/scene/sceneController');

    const room = buildRoomAndTable();
    room.updateMatrixWorld(true);

    for (const propName of [
      'PropRug',
      'PropTeaCabinet',
      'PropPottedPlant',
      'PropWallClock',
      'PropSideStool',
    ]) {
      expect(room.getObjectByName(propName)).toBeDefined();
    }

    // Above-floor props must remain behind or outside the table & rival chairs so they never enter table sightlines
    for (const propName of ['PropTeaCabinet', 'PropPottedPlant', 'PropWallClock', 'PropSideStool']) {
      const prop = room.getObjectByName(propName)!;
      const box = new THREE.Box3().setFromObject(prop);
      const isBehindTable = box.max.z < -TABLE_METRICS.railOuterRz - 0.5;
      const isOutsideTableX =
        box.min.x > TABLE_METRICS.railOuterRx + 1.0 ||
        box.max.x < -TABLE_METRICS.railOuterRx - 1.0;
      expect(isBehindTable || isOutsideTableX).toBe(true);
    }

    // Raycast sightlines from all camera presets to key tabletop targets (Hero cards, pot, call, board)
    const characters = buildCharacters();
    characters.root.updateMatrixWorld(true);
    const hero = characters.root.getObjectByName('HeroPresence')!;

    const tabletopTargets = [
      new THREE.Vector3(-0.18, 0.11, 0.88), // Hero left card
      new THREE.Vector3(0.18, 0.11, 0.88), // Hero right card
      new THREE.Vector3(-0.08, 0.04, 0.28), // Pot
      new THREE.Vector3(0.62, 0.04, 0.62), // Call pile
      new THREE.Vector3(0.02, 0.02, -0.22), // Board center
    ];

    const raycaster = new THREE.Raycaster();
    for (const preset of Object.values(CAMERA_PRESETS)) {
      const camPos = new THREE.Vector3(...preset.position);
      for (const target of tabletopTargets) {
        const dir = target.clone().sub(camPos).normalize();
        const dist = camPos.distanceTo(target);
        raycaster.set(camPos, dir);
        raycaster.near = 0.1;
        raycaster.far = dist;
        const hits = raycaster.intersectObject(hero, true);
        expect(hits).toHaveLength(0);
      }
    }
  });

  it('configures at most one shadow-casting light with a 1024 shadow map', async () => {
    const THREE = await import('three');
    const { DrillSceneController } = await import('../../../src/ui/drill3d/scene/sceneController');

    const fakeScene = new THREE.Scene();
    type LightSetupReceiver = {
      scene: import('three').Scene;
      setupLights: () => void;
    };
    const proto = DrillSceneController.prototype as unknown as LightSetupReceiver;
    proto.setupLights.call({ scene: fakeScene });

    const lights: import('three').Light[] = [];
    fakeScene.traverse((obj) => {
      if ((obj as import('three').Light).isLight) {
        lights.push(obj as import('three').Light);
      }
    });

    expect(lights.length).toBeGreaterThanOrEqual(3);
    const shadowCasters = lights.filter((l) => l.castShadow);
    expect(shadowCasters).toHaveLength(1);

    const keyCaster = shadowCasters[0] as import('three').SpotLight;
    expect(keyCaster).toBeInstanceOf(THREE.SpotLight);
    expect(keyCaster.shadow.mapSize.x).toBeLessThanOrEqual(1024);
    expect(keyCaster.shadow.mapSize.y).toBeLessThanOrEqual(1024);
  });

  it('draws larger, bolder card rank and suit indices while keeping the separate-lobe ♣ glyph intact', async () => {
    const fillTextCalls: FillTextCall[] = [];
    const arcCalls: ArcCall[] = [];
    const { mockCtx, createdCanvases } = createCanvasMock(fillTextCalls, arcCalls);

    const { CARD_TEXTURE_METRICS, createCardFaceTexture, drawSuitSymbol } = await import(
      '../../../src/ui/drill3d/scene/textures'
    );

    createCardFaceTexture('A♥');
    expect(createdCanvases[0]).toMatchObject({
      width: CARD_TEXTURE_METRICS.width,
      height: CARD_TEXTURE_METRICS.height,
    });
    expect(CARD_TEXTURE_METRICS.cornerRankFontSingle).toBeGreaterThanOrEqual(100);
    expect(CARD_TEXTURE_METRICS.cornerSuitSize).toBeGreaterThanOrEqual(68);
    expect(CARD_TEXTURE_METRICS.centerSuitSize).toBeGreaterThanOrEqual(170);

    const topRankCall = fillTextCalls.find((c) => c.text === 'A' && c.y < 50);
    expect(topRankCall).toBeDefined();
    expect(topRankCall!.font).toContain(`900 ${CARD_TEXTURE_METRICS.cornerRankFontSingle}px`);
    expect(topRankCall!.fillStyle).toBe('#C73B3A');

    // Verify ♣ draws 3 distinct separated circular lobes
    arcCalls.length = 0;
    drawSuitSymbol(mockCtx as unknown as CanvasRenderingContext2D, '♣', 100, 100, 80, '#24292E');
    expect(arcCalls).toHaveLength(3);
    const [topLobe, leftLobe, rightLobe] = arcCalls;
    expect(Math.hypot(leftLobe!.x - rightLobe!.x, leftLobe!.y - rightLobe!.y)).toBeGreaterThan(
      leftLobe!.r * 2,
    );
    expect(Math.hypot(topLobe!.x - leftLobe!.x, topLobe!.y - leftLobe!.y)).toBeGreaterThan(
      topLobe!.r * 1.6,
    );
  });
});
