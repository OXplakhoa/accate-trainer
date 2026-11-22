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

    const raycaster = new THREE.Raycaster();
    const downDir = new THREE.Vector3(0, -1, 0);
    const worldVertex = new THREE.Vector3();
    const railMeshTyped = railMesh as import('three').Mesh;
    const origSide = (railMeshTyped.material as import('three').Material).side;
    (railMeshTyped.material as import('three').Material).side = THREE.DoubleSide;

    const meshNames: string[] = [];
    hero!.traverse((obj) => {
      const mesh = obj as import('three').Mesh;
      if (!mesh.isMesh) {
        return;
      }
      meshNames.push(mesh.name);
      const box = new THREE.Box3().setFromObject(mesh);

      if (mesh.name === 'HeroSleeve') {
        // Sleeves extend outward past the outer rail edge and curve down outside the rail toward Hero's body
        expect(box.max.z).toBeGreaterThan(TABLE_METRICS.railOuterRz + 0.28);
      } else {
        // Every cuff, wrist, palm, finger and thumb mesh sits strictly above railBox.max.y
        expect(box.min.y).toBeGreaterThan(railBox.max.y);
      }

      // Every vertex of every Hero mesh must stay outside the TableRail volume (and strictly above railBox.max.y when over the rail)
      const posAttr = mesh.geometry.attributes.position;
      expect(posAttr).toBeDefined();
      if (posAttr) {
        for (let i = 0; i < posAttr.count; i += 1) {
          worldVertex.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
          const railFootprintNorm = Math.hypot(
            worldVertex.x / (TABLE_METRICS.railOuterRx + 0.04),
            worldVertex.z / (TABLE_METRICS.railOuterRz + 0.04),
          );
          if (railFootprintNorm <= 1.0) {
            expect(worldVertex.y).toBeGreaterThan(railBox.max.y);
          }
          if (railBox.containsPoint(worldVertex)) {
            raycaster.set(worldVertex, downDir);
            const hits = raycaster.intersectObject(railMeshTyped, false);
            expect(hits.length % 2).toBe(0);
          }
        }
      }

      // Verify horizontal position rests over the near rail ring and never covers hole cards, pot, call or board
      const center = box.getCenter(new THREE.Vector3());
      expect(center.z).toBeGreaterThan(1.1);
      expect(Math.abs(center.x)).toBeGreaterThan(0.38);

      const normOuter = Math.hypot(
        center.x / (TABLE_METRICS.railOuterRx + 0.06),
        center.z / (TABLE_METRICS.railOuterRz + 0.16),
      );
      const normInner = Math.hypot(
        center.x / (TABLE_METRICS.feltRx - 0.12),
        center.z / (TABLE_METRICS.feltRz - 0.12),
      );
      expect(normOuter).toBeLessThanOrEqual(1.0);
      expect(normInner).toBeGreaterThanOrEqual(0.95);
    });
    (railMeshTyped.material as import('three').Material).side = origSide;

    // Both left and right arms have sleeve, cuff, wrist, palm, 4 fingers, and thumb (9 meshes * 2 = 18)
    expect(meshNames).toHaveLength(18);
    expect(meshNames.filter((n) => n === 'HeroSleeve')).toHaveLength(2);
    expect(meshNames.filter((n) => n === 'HeroCuff')).toHaveLength(2);
    expect(meshNames.filter((n) => n === 'HeroPalm')).toHaveLength(2);
  });

  it('keeps zero vertices of any rival sleeve, cuff or hand mesh inside TableRail at rest and across every lean pose', async () => {
    const THREE = await import('three');
    const { buildRoomAndTable } = await import('../../../src/ui/drill3d/scene/buildRoomAndTable');
    const { buildCharacters, getLiveCharacterPose, PHASE_CHARACTER_POSES } = await import(
      '../../../src/ui/drill3d/scene/buildCharacters'
    );
    const { SCENE_COLORS } = await import('../../../src/ui/drill3d/scene/palette');

    const room = buildRoomAndTable();
    room.updateMatrixWorld(true);
    const railMesh = room.getObjectByName('TableRail') as import('three').Mesh;
    expect(railMesh).toBeDefined();
    const railBox = new THREE.Box3().setFromObject(railMesh);

    const characters = buildCharacters();
    characters.applyPose(PHASE_CHARACTER_POSES.decision);
    characters.root.updateMatrixWorld(true);

    // Distinct hand colors vs sleeve colors
    expect(SCENE_COLORS.caHand).not.toBe(SCENE_COLORS.caShirt);
    expect(SCENE_COLORS.caHand).not.toBe(SCENE_COLORS.caBlue);
    expect(SCENE_COLORS.caoPaw).not.toBe(SCENE_COLORS.caoJacket);
    expect(SCENE_COLORS.caoPaw).not.toBe(SCENE_COLORS.caoCream);
    expect(SCENE_COLORS.nongHand).not.toBe(SCENE_COLORS.nongSweater);

    // Real geometry point-in-mesh volume check against TableRail + railBox.max.y check
    const raycaster = new THREE.Raycaster();
    const downDir = new THREE.Vector3(0, -1, 0);
    const worldVertex = new THREE.Vector3();
    const originalRailSide = (railMesh.material as import('three').Material).side;
    (railMesh.material as import('three').Material).side = THREE.DoubleSide;

    const countVerticesInsideRail = (rootObj: import('three').Object3D): {
      totalVertices: number;
      insideRailVertices: number;
      minVertexY: number;
    } => {
      let totalVertices = 0;
      let insideRailVertices = 0;
      let minVertexY = Infinity;

      rootObj.traverse((obj) => {
        const mesh = obj as import('three').Mesh;
        if (!mesh.isMesh || !mesh.geometry) {
          return;
        }
        const posAttr = mesh.geometry.attributes.position;
        if (!posAttr) {
          return;
        }
        for (let i = 0; i < posAttr.count; i += 1) {
          worldVertex.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
          totalVertices += 1;
          if (worldVertex.y < minVertexY) {
            minVertexY = worldVertex.y;
          }
          if (railBox.containsPoint(worldVertex)) {
            raycaster.set(worldVertex, downDir);
            const hits = raycaster.intersectObject(railMesh, false);
            if (hits.length % 2 === 1) {
              insideRailVertices += 1;
            }
          }
        }
      });

      return { totalVertices, insideRailVertices, minVertexY };
    };

    const allPoses = [
      PHASE_CHARACTER_POSES.arrival,
      PHASE_CHARACTER_POSES.decision,
      PHASE_CHARACTER_POSES.review,
      getLiveCharacterPose(null, false, null),
      getLiveCharacterPose(null, true, 'flop'),
      ...(['ca', 'cao', 'nong'] as const).flatMap((rival) =>
        ([null, 'preflop', 'flop', 'turn', 'river'] as const).map((street) =>
          getLiveCharacterPose(rival, false, street),
        ),
      ),
      {
        ...PHASE_CHARACTER_POSES.decision,
        caLean: 0.11,
        caoLean: 0.11,
        nongLean: 0.11,
      },
    ];

    for (const rivalName of ['CharacterCa', 'CharacterCao', 'CharacterNong']) {
      characters.applyPose(PHASE_CHARACTER_POSES.decision);
      characters.root.updateMatrixWorld(true);

      const rival = characters.root.getObjectByName(rivalName)!;
      expect(rival).toBeDefined();

      const sleeveL = rival.getObjectByName('RivalSleeveLeft')!;
      const sleeveR = rival.getObjectByName('RivalSleeveRight')!;
      const handL = rival.getObjectByName('RivalHandLeft')!;
      const handR = rival.getObjectByName('RivalHandRight')!;
      expect(sleeveL).toBeDefined();
      expect(sleeveR).toBeDefined();
      expect(handL).toBeDefined();
      expect(handR).toBeDefined();

      const beforeL = handL.getWorldPosition(new THREE.Vector3());
      const beforeR = handR.getWorldPosition(new THREE.Vector3());

      for (const pose of allPoses) {
        characters.applyPose(pose);
        characters.root.updateMatrixWorld(true);

        for (const part of [sleeveL, sleeveR, handL, handR]) {
          const stats = countVerticesInsideRail(part);
          expect(stats.totalVertices).toBeGreaterThan(0);
          expect(stats.insideRailVertices).toBe(0);
          expect(stats.minVertexY).toBeGreaterThan(railBox.max.y);
        }
      }

      characters.applyPose({
        ...PHASE_CHARACTER_POSES.decision,
        caLean: 0.11,
        caoLean: 0.11,
        nongLean: 0.11,
      });
      characters.root.updateMatrixWorld(true);

      const afterL = handL.getWorldPosition(new THREE.Vector3());
      const afterR = handR.getWorldPosition(new THREE.Vector3());

      expect(beforeL.distanceTo(afterL)).toBeLessThan(0.015);
      expect(beforeR.distanceTo(afterR)).toBeLessThan(0.015);
    }

    (railMesh.material as import('three').Material).side = originalRailSide;
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

    // Potted plant leaves must not sit behind Nóng's spout and steam in the decision camera
    const { getLiveCharacterPose, PHASE_CHARACTER_POSES } = await import(
      '../../../src/ui/drill3d/scene/buildCharacters'
    );
    const pottedPlant = room.getObjectByName('PropPottedPlant')!;
    const nong = characters.root.getObjectByName('CharacterNong')!;
    const decisionPreset = CAMERA_PRESETS.decision;
    const decisionCamPos = new THREE.Vector3(...decisionPreset.position);

    const screenWidth = 390;
    const screenHeight = 844;
    const aspect = screenWidth / screenHeight;
    const minHRad = THREE.MathUtils.degToRad(decisionPreset.minHFov);
    const adaptiveVFov = Math.min(
      60,
      Math.max(
        decisionPreset.baseFov,
        THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(minHRad / 2) / aspect)),
      ),
    );
    const decisionCamera = new THREE.PerspectiveCamera(adaptiveVFov, aspect, 0.1, 32);
    decisionCamera.position.set(...decisionPreset.position);
    decisionCamera.lookAt(...decisionPreset.target);
    decisionCamera.updateMatrixWorld(true);
    decisionCamera.updateProjectionMatrix();

    const projectScreenBox = (targetObj: import('three').Object3D) => {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const worldV = new THREE.Vector3();
      targetObj.traverse((child) => {
        const mesh = child as import('three').Mesh;
        if (!mesh.isMesh || !mesh.geometry) {
          return;
        }
        const pos = mesh.geometry.attributes.position;
        if (!pos) {
          return;
        }
        for (let i = 0; i < pos.count; i += 1) {
          worldV.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(decisionCamera);
          const sx = (worldV.x * 0.5 + 0.5) * screenWidth;
          const sy = (-worldV.y * 0.5 + 0.5) * screenHeight;
          if (sx < minX) minX = sx;
          if (sx > maxX) maxX = sx;
          if (sy < minY) minY = sy;
          if (sy > maxY) maxY = sy;
        }
      });
      return { minX, maxX, minY, maxY };
    };

    const plantScreenBox = projectScreenBox(pottedPlant);
    for (const pose of [
      PHASE_CHARACTER_POSES.decision,
      getLiveCharacterPose(null, true, 'flop'),
      getLiveCharacterPose('nong', false, 'flop'),
    ]) {
      characters.applyPose(pose);
      characters.root.updateMatrixWorld(true);

      const nongScreenBox = projectScreenBox(nong);
      expect(plantScreenBox.minX).toBeGreaterThan(nongScreenBox.maxX);

      nong.traverse((obj) => {
        const mesh = obj as import('three').Mesh;
        if (!mesh.isMesh) {
          return;
        }
        const meshScreenBox = projectScreenBox(mesh);
        const overlaps2D =
          meshScreenBox.maxX >= plantScreenBox.minX &&
          meshScreenBox.minX <= plantScreenBox.maxX &&
          meshScreenBox.maxY >= plantScreenBox.minY &&
          meshScreenBox.minY <= plantScreenBox.maxY;
        expect(overlaps2D).toBe(false);

        const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
        const dir = center.clone().sub(decisionCamPos).normalize();
        raycaster.set(decisionCamPos, dir);
        raycaster.near = 0.1;
        raycaster.far = 15;
        const plantHits = raycaster.intersectObject(pottedPlant, true);
        expect(plantHits).toHaveLength(0);
      });
    }

    // Mobile performance: clock ticks batched in one InstancedMesh, shared hand geometries, FrontSide leaves, reduced shadow casters
    const wallClock = room.getObjectByName('PropWallClock')!;
    let clockInstancedCount = 0;
    wallClock.traverse((obj) => {
      if ((obj as import('three').InstancedMesh).isInstancedMesh) {
        clockInstancedCount += 1;
        expect((obj as import('three').InstancedMesh).count).toBe(12);
      }
    });
    expect(clockInstancedCount).toBe(1);

    for (const propName of ['PropTeaCabinet', 'PropPottedPlant', 'PropWallClock', 'PropSideStool']) {
      room.getObjectByName(propName)!.traverse((obj) => {
        const mesh = obj as import('three').Mesh;
        if (mesh.isMesh) {
          expect(mesh.castShadow).toBe(false);
          const mat = mesh.material as import('three').Material;
          expect(mat.side).toBe(THREE.FrontSide);
        }
      });
    }

    const handGeometries = new Set<import('three').BufferGeometry>();
    for (const rivalName of ['CharacterCa', 'CharacterCao', 'CharacterNong']) {
      const rival = characters.root.getObjectByName(rivalName)!;
      for (const handName of ['RivalHandLeft', 'RivalHandRight']) {
        rival.getObjectByName(handName)!.traverse((obj) => {
          const mesh = obj as import('three').Mesh;
          if (mesh.isMesh) {
            handGeometries.add(mesh.geometry);
          }
        });
      }
    }
    // All 6 rival hands share one set of 4 geometries (cuff, palm, finger, thumb)
    expect(handGeometries.size).toBe(4);
  });

  it('configures at most one shadow-casting light with a 1024 shadow map and disposes lights in disposeObject3DResources', async () => {
    const THREE = await import('three');
    const { DrillSceneController } = await import('../../../src/ui/drill3d/scene/sceneController');
    const { disposeObject3DResources } = await import('../../../src/ui/drill3d/scene/palette');

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
    expect(fakeScene.children).toContain(keyCaster.target);

    const disposeSpy = vi.spyOn(keyCaster, 'dispose');
    disposeObject3DResources(fakeScene);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
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
