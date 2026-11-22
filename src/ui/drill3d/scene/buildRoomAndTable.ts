import * as THREE from 'three';
import { createMatteMaterial, SCENE_COLORS } from './palette';
import { createFeltTexture, createWallArtTexture, createWoodTexture } from './textures';

export const TABLE_METRICS = {
  feltRx: 2.02,
  feltRz: 1.24,
  railOuterRx: 2.28,
  railOuterRz: 1.5,
  floorY: -0.82,
} as const;

function createOvalShape(rx: number, rz: number, segments = 72): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i <= segments; i += 1) {
    const theta = (i / segments) * Math.PI * 2;
    const x = Math.cos(theta) * rx;
    const y = Math.sin(theta) * rz;
    if (i === 0) {
      shape.moveTo(x, y);
    } else {
      shape.lineTo(x, y);
    }
  }
  shape.closePath();
  return shape;
}

function createOvalPath(rx: number, rz: number, segments = 72): THREE.Path {
  const path = new THREE.Path();
  for (let i = 0; i <= segments; i += 1) {
    const theta = (i / segments) * Math.PI * 2;
    const x = Math.cos(theta) * rx;
    const y = Math.sin(theta) * rz;
    if (i === 0) {
      path.moveTo(x, y);
    } else {
      path.lineTo(x, y);
    }
  }
  path.closePath();
  return path;
}

interface SharedChairGeometries {
  readonly seatGeo: THREE.CylinderGeometry;
  readonly apronGeo: THREE.CylinderGeometry;
  readonly legGeo: THREE.CylinderGeometry;
}

function buildChair(
  woodMat: THREE.MeshStandardMaterial,
  cushionMat: THREE.MeshStandardMaterial,
  sharedGeos: SharedChairGeometries,
  options: { readonly lowBack?: boolean } = {},
): THREE.Group {
  const chair = new THREE.Group();
  const seatY = -0.34;

  // Seat cushion
  const seat = new THREE.Mesh(sharedGeos.seatGeo, cushionMat);
  seat.position.y = seatY;
  seat.castShadow = true;
  seat.receiveShadow = true;
  chair.add(seat);

  // Wooden seat apron
  const apron = new THREE.Mesh(sharedGeos.apronGeo, woodMat);
  apron.position.y = seatY - 0.055;
  chair.add(apron);

  // 4 tapered legs
  const legOffsets: readonly [number, number][] = [
    [-0.22, -0.22],
    [0.22, -0.22],
    [-0.22, 0.22],
    [0.22, 0.22],
  ];
  for (const [lx, lz] of legOffsets) {
    const leg = new THREE.Mesh(sharedGeos.legGeo, woodMat);
    leg.position.set(lx, seatY - 0.26, lz);
    chair.add(leg);
  }

  // Curved bentwood backrest behind seat (-Z in chair local space)
  const backHeight = options.lowBack ? 0.34 : 0.68;
  const postGeo = new THREE.CylinderGeometry(0.022, 0.024, backHeight, 10);
  for (const sx of [-0.25, 0.25]) {
    const post = new THREE.Mesh(postGeo, woodMat);
    post.position.set(sx, seatY + backHeight * 0.5, -0.26);
    post.rotation.x = -0.09;
    post.castShadow = true;
    chair.add(post);
  }

  const railCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.27, seatY + backHeight, -0.27),
    new THREE.Vector3(-0.15, seatY + backHeight + 0.06, -0.33),
    new THREE.Vector3(0, seatY + backHeight + 0.08, -0.35),
    new THREE.Vector3(0.15, seatY + backHeight + 0.06, -0.33),
    new THREE.Vector3(0.27, seatY + backHeight, -0.27),
  ]);
  const topRailGeo = new THREE.TubeGeometry(railCurve, 20, 0.032, 10, false);
  const topRail = new THREE.Mesh(topRailGeo, woodMat);
  topRail.castShadow = true;
  chair.add(topRail);

  if (!options.lowBack) {
    const midRailCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.25, seatY + backHeight * 0.52, -0.26),
      new THREE.Vector3(0, seatY + backHeight * 0.55, -0.32),
      new THREE.Vector3(0.25, seatY + backHeight * 0.52, -0.26),
    ]);
    const midRailGeo = new THREE.TubeGeometry(midRailCurve, 14, 0.022, 8, false);
    const midRail = new THREE.Mesh(midRailGeo, woodMat);
    chair.add(midRail);
  }

  return chair;
}

function buildSideCabinetWithTeaSet(
  cabinetWoodMat: THREE.MeshStandardMaterial,
  cabinetDarkMat: THREE.MeshStandardMaterial,
  brassMat: THREE.MeshStandardMaterial,
  trayMat: THREE.MeshStandardMaterial,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'PropTeaCabinet';

  const celadonMat = createMatteMaterial(SCENE_COLORS.propCeladon, {
    roughness: 0.58,
    metalness: 0.06,
  });

  // Low-poly tapered wooden legs
  const legGeo = new THREE.CylinderGeometry(0.032, 0.022, 0.22, 8);
  const legCoords: readonly [number, number][] = [
    [-0.56, -0.22],
    [0.56, -0.22],
    [-0.56, 0.22],
    [0.56, 0.22],
  ];
  for (const [lx, lz] of legCoords) {
    const leg = new THREE.Mesh(legGeo, cabinetDarkMat);
    leg.position.set(lx, 0.11, lz);
    group.add(leg);
  }

  // Cabinet carcass & overhanging top slab (outside spotlight cone -> castShadow = false)
  const carcass = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.64, 0.52), cabinetWoodMat);
  carcass.position.set(0, 0.52, 0);
  carcass.receiveShadow = true;
  group.add(carcass);

  const topSlab = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.05, 0.58), cabinetDarkMat);
  topSlab.position.set(0, 0.865, 0);
  topSlab.receiveShadow = true;
  group.add(topSlab);

  // Twin recessed front door panels with brass pulls (shared geometries)
  const panelGeo = new THREE.BoxGeometry(0.52, 0.48, 0.03);
  const knobGeo = new THREE.SphereGeometry(0.018, 8, 8);
  for (const sx of [-1, 1]) {
    const panel = new THREE.Mesh(panelGeo, cabinetDarkMat);
    panel.position.set(sx * 0.29, 0.52, 0.255);
    group.add(panel);

    const knob = new THREE.Mesh(knobGeo, brassMat);
    knob.position.set(sx * 0.07, 0.52, 0.28);
    group.add(knob);
  }

  // Round wooden tea tray on top of the cabinet (y = 0.89)
  const trayY = 0.89;
  const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.23, 0.024, 18), trayMat);
  tray.position.set(-0.14, trayY + 0.012, 0.02);
  group.add(tray);

  // Celadon Vietnamese teapot (ấm trà)
  const teapot = new THREE.Group();
  teapot.position.set(-0.18, trayY + 0.024, 0.0);

  const potBody = new THREE.Mesh(new THREE.SphereGeometry(0.082, 14, 12), celadonMat);
  potBody.scale.set(1.08, 0.86, 1.08);
  potBody.position.y = 0.068;
  teapot.add(potBody);

  const potLid = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.052, 0.02, 12), celadonMat);
  potLid.position.y = 0.135;
  teapot.add(potLid);

  const lidFinial = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), brassMat);
  lidFinial.position.y = 0.152;
  teapot.add(lidFinial);

  const potSpout = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.018, 0.075, 8), celadonMat);
  potSpout.position.set(0.088, 0.085, 0);
  potSpout.rotation.z = -0.78;
  teapot.add(potSpout);

  const potHandle = new THREE.Mesh(
    new THREE.TorusGeometry(0.042, 0.009, 8, 14, Math.PI * 1.15),
    brassMat,
  );
  potHandle.position.set(0, 0.125, 0);
  teapot.add(potHandle);
  group.add(teapot);

  // Four small celadon teacups (chén trà) arranged on the tray
  const cupGeo = new THREE.CylinderGeometry(0.026, 0.019, 0.038, 10);
  const cupOffsets: readonly [number, number][] = [
    [-0.02, -0.08],
    [0.04, 0.02],
    [-0.03, 0.11],
    [-0.14, 0.13],
  ];
  for (const [cx, cz] of cupOffsets) {
    const cup = new THREE.Mesh(cupGeo, celadonMat);
    cup.position.set(cx, trayY + 0.043, cz);
    group.add(cup);
  }

  // Brass tea canister beside the tray
  const caddy = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.068, 0.16, 14), brassMat);
  caddy.position.set(0.32, trayY + 0.08, -0.04);
  group.add(caddy);

  const caddyLid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.056, 0.067, 0.028, 14),
    cabinetDarkMat,
  );
  caddyLid.position.set(0.32, trayY + 0.17, -0.04);
  group.add(caddyLid);

  return group;
}

function buildPottedPlant(
  woodMat: THREE.MeshStandardMaterial,
  soilMat: THREE.MeshStandardMaterial,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'PropPottedPlant';

  const planterMat = createMatteMaterial(SCENE_COLORS.propPlanter, { roughness: 0.78 });
  const leafMat = createMatteMaterial(SCENE_COLORS.propLeaf, {
    roughness: 0.76,
  });
  const leafLightMat = createMatteMaterial(SCENE_COLORS.propLeafLight, {
    roughness: 0.74,
  });

  // Low wooden plant stand
  const standRing = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.035, 16), woodMat);
  standRing.position.y = 0.16;
  group.add(standRing);

  const standLegGeo = new THREE.CylinderGeometry(0.022, 0.016, 0.18, 8);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(standLegGeo, woodMat);
    leg.position.set(Math.cos(angle) * 0.19, 0.085, Math.sin(angle) * 0.19);
    group.add(leg);
  }

  // Glazed terracotta planter pot (outside spotlight cone -> castShadow = false)
  const potProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.18, 0.0),
    new THREE.Vector2(0.25, 0.22),
    new THREE.Vector2(0.27, 0.42),
    new THREE.Vector2(0.29, 0.45),
    new THREE.Vector2(0.25, 0.47),
  ];
  const potMesh = new THREE.Mesh(new THREE.LatheGeometry(potProfile, 18), planterMat);
  potMesh.position.y = 0.175;
  potMesh.receiveShadow = true;
  group.add(potMesh);

  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 16), soilMat);
  soil.position.y = 0.61;
  group.add(soil);

  // Broad arching tropical parlor leaves (closed ExtrudeGeometry with FrontSide and castShadow = false)
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.14, 0.16, 0.13, 0.38);
  leafShape.quadraticCurveTo(0.08, 0.56, 0.0, 0.66);
  leafShape.quadraticCurveTo(-0.08, 0.56, -0.13, 0.38);
  leafShape.quadraticCurveTo(-0.14, 0.16, 0, 0);
  const leafGeo = new THREE.ExtrudeGeometry(leafShape, {
    depth: 0.012,
    bevelEnabled: false,
    curveSegments: 10,
  });

  const leafSpecs: readonly { rotY: number; pitch: number; scale: number; y: number; light?: boolean }[] = [
    { rotY: 0.2, pitch: 0.55, scale: 1.05, y: 0.62 },
    { rotY: 1.1, pitch: 0.68, scale: 0.96, y: 0.6, light: true },
    { rotY: 2.0, pitch: 0.52, scale: 1.1, y: 0.63 },
    { rotY: 2.9, pitch: 0.72, scale: 0.92, y: 0.59, light: true },
    { rotY: 3.8, pitch: 0.6, scale: 1.02, y: 0.62 },
    { rotY: 4.7, pitch: 0.44, scale: 0.88, y: 0.65, light: true },
    { rotY: 5.5, pitch: 0.35, scale: 0.82, y: 0.66 },
  ];

  for (const spec of leafSpecs) {
    const leafPivot = new THREE.Group();
    leafPivot.position.set(0, spec.y, 0);
    leafPivot.rotation.y = spec.rotY;

    const leaf = new THREE.Mesh(leafGeo, spec.light ? leafLightMat : leafMat);
    leaf.rotation.x = spec.pitch;
    leaf.scale.setScalar(spec.scale);
    leafPivot.add(leaf);
    group.add(leafPivot);
  }

  return group;
}

function buildWallClock(
  woodMat: THREE.MeshStandardMaterial,
  brassMat: THREE.MeshStandardMaterial,
): THREE.Group {
  const clock = new THREE.Group();
  clock.name = 'PropWallClock';

  const faceMat = createMatteMaterial(SCENE_COLORS.ivory, { roughness: 0.82 });
  const handMat = createMatteMaterial(SCENE_COLORS.ink, { roughness: 0.6 });

  // Wooden octagonal/round case bezel (no text or numerals, outside spotlight cone -> castShadow = false)
  const bezelGeo = new THREE.CylinderGeometry(0.32, 0.34, 0.06, 16);
  bezelGeo.rotateX(Math.PI / 2);
  const bezel = new THREE.Mesh(bezelGeo, woodMat);
  clock.add(bezel);

  const brassRim = new THREE.Mesh(new THREE.TorusGeometry(0.275, 0.016, 10, 24), brassMat);
  brassRim.position.z = 0.032;
  clock.add(brassRim);

  const dialGeo = new THREE.CylinderGeometry(0.265, 0.265, 0.016, 24);
  dialGeo.rotateX(Math.PI / 2);
  const dial = new THREE.Mesh(dialGeo, faceMat);
  dial.position.z = 0.028;
  clock.add(dial);

  // 12 geometric brass hour ticks batched into a single InstancedMesh (1 draw call, zero text/logos)
  const tickGeo = new THREE.BoxGeometry(0.014, 0.034, 0.01);
  const ticksMesh = new THREE.InstancedMesh(tickGeo, brassMat, 12);
  const tickDummy = new THREE.Object3D();
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const isMajor = i % 3 === 0;
    const r = 0.215;
    tickDummy.position.set(Math.sin(angle) * r, Math.cos(angle) * r, 0.04);
    tickDummy.rotation.set(0, 0, -angle);
    tickDummy.scale.set(isMajor ? 1.18 : 0.74, isMajor ? 1.24 : 0.76, 1);
    tickDummy.updateMatrix();
    ticksMesh.setMatrixAt(i, tickDummy.matrix);
  }
  ticksMesh.instanceMatrix.needsUpdate = true;
  clock.add(ticksMesh);

  // Hour hand (~9 o'clock) & minute hand (~10 minutes past)
  const hourHand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.02, 0.01), handMat);
  hourHand.position.set(-0.055, 0.01, 0.044);
  hourHand.rotation.z = -0.18;
  clock.add(hourHand);

  const minuteHand = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.18, 0.01), handMat);
  minuteHand.position.set(0.042, 0.068, 0.046);
  minuteHand.rotation.z = -0.56;
  clock.add(minuteHand);

  const centerPin = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), brassMat);
  centerPin.position.z = 0.05;
  clock.add(centerPin);

  return clock;
}

function buildSideStool(
  woodMat: THREE.MeshStandardMaterial,
  darkWoodMat: THREE.MeshStandardMaterial,
  brassMat: THREE.MeshStandardMaterial,
): THREE.Group {
  const stool = new THREE.Group();
  stool.name = 'PropSideStool';

  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.24, 0.045, 16), woodMat);
  top.position.y = 0.46;
  top.receiveShadow = true;
  stool.add(top);

  const legGeo = new THREE.CylinderGeometry(0.022, 0.016, 0.45, 8);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(legGeo, darkWoodMat);
    leg.position.set(Math.cos(angle) * 0.16, 0.225, Math.sin(angle) * 0.16);
    leg.rotation.z = -Math.cos(angle) * 0.08;
    leg.rotation.x = Math.sin(angle) * 0.08;
    stool.add(leg);
  }

  // Small stack of wooden coasters & brass coaster holder on top
  const coasterStack = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.065, 0.036, 12),
    darkWoodMat,
  );
  coasterStack.position.set(-0.04, 0.5, 0.02);
  stool.add(coasterStack);

  const coasterRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.068, 0.006, 8, 16),
    brassMat,
  );
  coasterRim.rotation.x = Math.PI / 2;
  coasterRim.position.set(-0.04, 0.495, 0.02);
  stool.add(coasterRim);

  return stool;
}

export function buildRoomAndTable(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'RoomAndTable';

  const floorY = TABLE_METRICS.floorY;

  // --- 1. WARM CREAM CARD ROOM ---
  const wallMat = createMatteMaterial(SCENE_COLORS.roomWall, { roughness: 0.94 });
  const wallSideMat = createMatteMaterial(SCENE_COLORS.roomWallShade, { roughness: 0.94 });
  const wainscotMat = createMatteMaterial(SCENE_COLORS.roomWainscot, { roughness: 0.9 });
  const trimMat = createMatteMaterial(SCENE_COLORS.roomTrim, { roughness: 0.85 });
  const floorTex = createWoodTexture('#C59F76', '#8F6A44');
  const floorMat = createMatteMaterial(0xffffff, { map: floorTex, roughness: 0.84 });

  // Warm timber floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 16), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  root.add(floor);

  // Layered woven parlor rug under the poker table
  const rugGroup = new THREE.Group();
  rugGroup.name = 'PropRug';
  const cabinetWoodMat = createMatteMaterial(SCENE_COLORS.propCabinetWood, { roughness: 0.8 });
  const cabinetDarkMat = createMatteMaterial(SCENE_COLORS.propCabinetDark, { roughness: 0.84 });

  const rugOuterShape = createOvalShape(3.56, 2.74, 64);
  const rugOuter = new THREE.Mesh(
    new THREE.ShapeGeometry(rugOuterShape),
    cabinetDarkMat,
  );
  rugOuter.rotation.x = -Math.PI / 2;
  rugOuter.position.y = floorY + 0.004;
  rugOuter.receiveShadow = true;
  rugGroup.add(rugOuter);

  const rugBandShape = createOvalShape(3.46, 2.64, 64);
  const rugBand = new THREE.Mesh(
    new THREE.ShapeGeometry(rugBandShape),
    createMatteMaterial(SCENE_COLORS.propRugBand, { roughness: 0.95 }),
  );
  rugBand.rotation.x = -Math.PI / 2;
  rugBand.position.y = floorY + 0.006;
  rugBand.receiveShadow = true;
  rugGroup.add(rugBand);

  const rugGoldShape = createOvalShape(3.18, 2.36, 64);
  rugGoldShape.holes.push(createOvalPath(3.08, 2.26, 64));
  const rugGold = new THREE.Mesh(
    new THREE.ShapeGeometry(rugGoldShape),
    createMatteMaterial(SCENE_COLORS.propRugGold, { roughness: 0.94 }),
  );
  rugGold.rotation.x = -Math.PI / 2;
  rugGold.position.y = floorY + 0.009;
  rugGroup.add(rugGold);

  const rugFieldShape = createOvalShape(3.08, 2.26, 64);
  const rugField = new THREE.Mesh(
    new THREE.ShapeGeometry(rugFieldShape),
    createMatteMaterial(SCENE_COLORS.propRugField, { roughness: 0.96 }),
  );
  rugField.rotation.x = -Math.PI / 2;
  rugField.position.y = floorY + 0.008;
  rugField.receiveShadow = true;
  rugGroup.add(rugField);

  root.add(rugGroup);

  // Back wall (-Z), Left wall (-X), Right wall (+X)
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(18, 8.5), wallMat);
  backWall.position.set(0, floorY + 4.25, -4.4);
  backWall.receiveShadow = true;
  root.add(backWall);

  const sideWallGeo = new THREE.PlaneGeometry(14, 8.5);
  const leftWall = new THREE.Mesh(sideWallGeo, wallSideMat);
  leftWall.position.set(-5.6, floorY + 4.25, 1.0);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.receiveShadow = true;
  root.add(leftWall);

  const rightWall = new THREE.Mesh(sideWallGeo, wallSideMat);
  rightWall.position.set(5.6, floorY + 4.25, 1.0);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.receiveShadow = true;
  root.add(rightWall);

  // Back & side wall wainscoting + chair rail molding (shared geometries for left & right sides)
  const wainscotBack = new THREE.Mesh(new THREE.BoxGeometry(16, 1.45, 0.08), wainscotMat);
  wainscotBack.position.set(0, floorY + 0.725, -4.36);
  wainscotBack.receiveShadow = true;
  root.add(wainscotBack);

  const chairRailBack = new THREE.Mesh(new THREE.BoxGeometry(16, 0.09, 0.13), trimMat);
  chairRailBack.position.set(0, floorY + 1.46, -4.34);
  root.add(chairRailBack);

  const wainscotSideGeo = new THREE.BoxGeometry(0.08, 1.45, 12);
  const chairRailSideGeo = new THREE.BoxGeometry(0.13, 0.09, 12);
  for (const sx of [-1, 1]) {
    const wainscotSide = new THREE.Mesh(wainscotSideGeo, wainscotMat);
    wainscotSide.position.set(sx * 5.55, floorY + 0.725, 0.5);
    wainscotSide.receiveShadow = true;
    root.add(wainscotSide);

    const chairRailSide = new THREE.Mesh(chairRailSideGeo, trimMat);
    chairRailSide.position.set(sx * 5.53, floorY + 1.46, 0.5);
    root.add(chairRailSide);
  }

  // Sunlit window alcove on the left wall (warm natural daylight feel)
  const windowFrameMat = createMatteMaterial(0xeadcc6, { roughness: 0.85 });
  const windowPaneMat = createMatteMaterial(SCENE_COLORS.windowGlow, {
    roughness: 0.5,
    emissive: 0xfff4dd,
    emissiveIntensity: 0.65,
  });
  const windowGroup = new THREE.Group();
  windowGroup.position.set(-5.52, 1.55, -1.6);
  windowGroup.rotation.y = Math.PI / 2;

  const pane = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.5), windowPaneMat);
  windowGroup.add(pane);

  const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.58, 0.08), windowFrameMat);
  mullionV.position.z = 0.03;
  windowGroup.add(mullionV);
  const mullionH = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.07, 0.08), windowFrameMat);
  mullionH.position.z = 0.03;
  windowGroup.add(mullionH);
  root.add(windowGroup);

  // Tasteful vintage matte framed prints on the back wall (shared frame and canvas geometries)
  const frameWoodMat = createMatteMaterial(SCENE_COLORS.tableRim, { roughness: 0.8 });
  const artFrameGeo = new THREE.BoxGeometry(0.92, 1.14, 0.06);
  const artCanvasGeo = new THREE.PlaneGeometry(0.78, 0.98);
  const artSpecs: readonly { x: number; suit: '♥' | '♠' | '♦'; color: string }[] = [
    { x: -2.4, suit: '♠', color: '#3E5768' },
    { x: 0, suit: '♥', color: '#C95849' },
    { x: 2.4, suit: '♦', color: '#D18244' },
  ];
  for (const spec of artSpecs) {
    const artGroup = new THREE.Group();
    artGroup.position.set(spec.x, 1.78, -4.32);

    const frame = new THREE.Mesh(artFrameGeo, frameWoodMat);
    frame.castShadow = true;
    artGroup.add(frame);

    const artTex = createWallArtTexture(spec.suit, spec.color);
    const canvasMesh = new THREE.Mesh(
      artCanvasGeo,
      createMatteMaterial(0xffffff, { map: artTex, roughness: 0.92 }),
    );
    canvasMesh.position.z = 0.034;
    artGroup.add(canvasMesh);

    root.add(artGroup);
  }

  // Warm overhead linen & brass pendant lamp (placed high enough to stay out of decision sightlines)
  const lampGroup = new THREE.Group();
  lampGroup.position.set(0, 2.86, -0.15);
  const brassMat = createMatteMaterial(SCENE_COLORS.pendantBrass, {
    roughness: 0.52,
    metalness: 0.25,
  });
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.6, 8), brassMat);
  cord.position.y = 0.85;
  lampGroup.add(cord);

  const shadeProfile = [
    new THREE.Vector2(0.14, 0.26),
    new THREE.Vector2(0.46, 0.16),
    new THREE.Vector2(0.68, 0.0),
    new THREE.Vector2(0.64, -0.02),
    new THREE.Vector2(0.12, 0.23),
  ];
  const shadeGeo = new THREE.LatheGeometry(shadeProfile, 32);
  const shadeMat = createMatteMaterial(SCENE_COLORS.pendantShade, {
    roughness: 0.86,
    emissive: 0xffefd0,
    emissiveIntensity: 0.22,
    side: THREE.DoubleSide,
  });
  const shade = new THREE.Mesh(shadeGeo, shadeMat);
  lampGroup.add(shade);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 14, 12),
    createMatteMaterial(0xfff7e3, {
      roughness: 0.3,
      emissive: 0xffecc2,
      emissiveIntensity: 1.35,
    }),
  );
  bulb.position.y = 0.05;
  lampGroup.add(bulb);
  root.add(lampGroup);

  // Vietnamese home-game background props (placed strictly behind the chairs/table, out of all table sightlines)
  const teaCabinet = buildSideCabinetWithTeaSet(
    cabinetWoodMat,
    cabinetDarkMat,
    brassMat,
    frameWoodMat,
  );
  teaCabinet.position.set(-3.36, floorY, -3.72);
  teaCabinet.rotation.y = 0.22;
  root.add(teaCabinet);

  const pottedPlant = buildPottedPlant(cabinetWoodMat, cabinetDarkMat);
  pottedPlant.position.set(4.52, floorY, -3.26);
  root.add(pottedPlant);

  const wallClock = buildWallClock(cabinetDarkMat, brassMat);
  wallClock.position.set(1.22, 1.98, -4.33);
  root.add(wallClock);

  const sideStool = buildSideStool(cabinetWoodMat, cabinetDarkMat, brassMat);
  sideStool.position.set(4.25, floorY, -1.95);
  root.add(sideStool);

  // --- 2. REAL OVAL POKER TABLE ---
  const tableGroup = new THREE.Group();
  tableGroup.name = 'OvalPokerTable';

  const feltTex = createFeltTexture();
  const feltMat = createMatteMaterial(0xffffff, {
    map: feltTex,
    roughness: 0.94,
    metalness: 0.01,
  });

  const rimWoodTex = createWoodTexture('#533C31', '#3B281F');
  const rimMat = createMatteMaterial(0xffffff, {
    map: rimWoodTex,
    roughness: 0.78,
    metalness: 0.04,
  });
  const rimDarkMat = createMatteMaterial(0x422e25, { roughness: 0.84 });
  const trimLineMat = createMatteMaterial(0xe7d6b9, {
    roughness: 0.9,
    transparent: true,
    opacity: 0.34,
  });

  // Oval felt playing surface at y = 0
  const feltShape = createOvalShape(TABLE_METRICS.feltRx, TABLE_METRICS.feltRz, 80);
  const feltGeo = new THREE.ExtrudeGeometry(feltShape, {
    depth: 0.07,
    bevelEnabled: false,
    curveSegments: 48,
  });
  feltGeo.rotateX(Math.PI / 2);
  // Normalize UVs cleanly onto [0, 1] across the oval
  const feltPos = feltGeo.attributes.position;
  const feltUv = feltGeo.attributes.uv;
  if (feltPos && feltUv) {
    for (let i = 0; i < feltPos.count; i += 1) {
      const px = feltPos.getX(i);
      const pz = feltPos.getZ(i);
      feltUv.setXY(
        i,
        (px / (TABLE_METRICS.feltRx * 2)) + 0.5,
        (pz / (TABLE_METRICS.feltRz * 2)) + 0.5,
      );
    }
    feltUv.needsUpdate = true;
  }
  const feltMesh = new THREE.Mesh(feltGeo, feltMat);
  feltMesh.position.y = 0;
  feltMesh.receiveShadow = true;
  tableGroup.add(feltMesh);

  // Subtle painted oval betting line on the felt
  const betLineShape = createOvalShape(TABLE_METRICS.feltRx * 0.78, TABLE_METRICS.feltRz * 0.73, 72);
  betLineShape.holes.push(
    createOvalPath(TABLE_METRICS.feltRx * 0.765, TABLE_METRICS.feltRz * 0.71, 72),
  );
  const betLineMesh = new THREE.Mesh(new THREE.ShapeGeometry(betLineShape), trimLineMat);
  betLineMesh.rotation.x = -Math.PI / 2;
  betLineMesh.position.y = 0.0025;
  tableGroup.add(betLineMesh);

  // Sculpted beveled cocoa outer wooden rail (#533C31)
  const railShape = createOvalShape(TABLE_METRICS.railOuterRx, TABLE_METRICS.railOuterRz, 80);
  railShape.holes.push(createOvalPath(TABLE_METRICS.feltRx - 0.03, TABLE_METRICS.feltRz - 0.03, 80));
  const railGeo = new THREE.ExtrudeGeometry(railShape, {
    depth: 0.13,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.04,
    bevelSegments: 4,
    curveSegments: 48,
  });
  railGeo.rotateX(Math.PI / 2);
  const railMesh = new THREE.Mesh(railGeo, rimMat);
  railMesh.name = 'TableRail';
  railMesh.position.y = 0.072;
  railMesh.castShadow = true;
  railMesh.receiveShadow = true;
  tableGroup.add(railMesh);

  // Recessed warm cocoa inner rail trim lip
  const innerLipShape = createOvalShape(TABLE_METRICS.feltRx + 0.01, TABLE_METRICS.feltRz + 0.01, 72);
  innerLipShape.holes.push(
    createOvalPath(TABLE_METRICS.feltRx - 0.055, TABLE_METRICS.feltRz - 0.055, 72),
  );
  const innerLipGeo = new THREE.ExtrudeGeometry(innerLipShape, {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  innerLipGeo.rotateX(Math.PI / 2);
  const innerLip = new THREE.Mesh(innerLipGeo, rimDarkMat);
  innerLip.position.y = 0.032;
  innerLip.receiveShadow = true;
  tableGroup.add(innerLip);

  // Under-table apron
  const apronShape = createOvalShape(TABLE_METRICS.feltRx * 0.94, TABLE_METRICS.feltRz * 0.92, 64);
  const apronGeo = new THREE.ExtrudeGeometry(apronShape, {
    depth: 0.12,
    bevelEnabled: false,
  });
  apronGeo.rotateX(Math.PI / 2);
  const apronMesh = new THREE.Mesh(apronGeo, rimDarkMat);
  apronMesh.position.y = -0.07;
  apronMesh.castShadow = true;
  tableGroup.add(apronMesh);

  // Twin turned wooden pedestal columns + crossbar
  const pedProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.32, 0.0),
    new THREE.Vector2(0.28, 0.07),
    new THREE.Vector2(0.14, 0.16),
    new THREE.Vector2(0.11, 0.36),
    new THREE.Vector2(0.16, 0.48),
    new THREE.Vector2(0.12, 0.62),
    new THREE.Vector2(0.22, 0.68),
    new THREE.Vector2(0.0, 0.68),
  ];
  const pedGeo = new THREE.LatheGeometry(pedProfile, 24);
  for (const px of [-0.95, 0.95]) {
    const pedestal = new THREE.Mesh(pedGeo, rimMat);
    pedestal.position.set(px, floorY, 0);
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    tableGroup.add(pedestal);
  }

  const stretcher = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.12), rimDarkMat);
  stretcher.position.set(0, floorY + 0.18, 0);
  stretcher.castShadow = true;
  tableGroup.add(stretcher);

  root.add(tableGroup);

  // --- 3. FOUR PARLOR CHAIRS ---
  const chairWoodMat = createMatteMaterial(SCENE_COLORS.chairWood, { roughness: 0.8 });
  const chairCushionMat = createMatteMaterial(SCENE_COLORS.chairCushion, { roughness: 0.9 });
  const sharedChairGeos: SharedChairGeometries = {
    seatGeo: new THREE.CylinderGeometry(0.32, 0.34, 0.08, 20),
    apronGeo: new THREE.CylinderGeometry(0.35, 0.33, 0.05, 20),
    legGeo: new THREE.CylinderGeometry(0.024, 0.018, 0.44, 10),
  };

  const chairPlacements: readonly { x: number; z: number; rotY: number; lowBack?: boolean }[] = [
    // Cá (left-far)
    { x: -1.84, z: -1.16, rotY: 0.92 },
    // Cáo (center-far)
    { x: 0.0, z: -1.76, rotY: 0.0 },
    // Nóng (right-far)
    { x: 1.84, z: -1.16, rotY: -0.92 },
    // Hero (near edge — low backrest so it frames arrival without ever blocking decision view)
    { x: 0.0, z: 1.84, rotY: Math.PI, lowBack: true },
  ];

  for (const p of chairPlacements) {
    const chair = buildChair(chairWoodMat, chairCushionMat, sharedChairGeos, {
      lowBack: p.lowBack,
    });
    chair.position.set(p.x, 0, p.z);
    chair.rotation.y = p.rotY;
    root.add(chair);
  }

  return root;
}
