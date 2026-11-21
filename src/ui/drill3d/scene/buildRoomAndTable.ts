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

function buildChair(
  woodMat: THREE.MeshStandardMaterial,
  cushionMat: THREE.MeshStandardMaterial,
  options: { readonly lowBack?: boolean } = {},
): THREE.Group {
  const chair = new THREE.Group();
  const seatY = -0.34;

  // Seat cushion
  const seatGeo = new THREE.CylinderGeometry(0.32, 0.34, 0.08, 20);
  const seat = new THREE.Mesh(seatGeo, cushionMat);
  seat.position.y = seatY;
  seat.castShadow = true;
  seat.receiveShadow = true;
  chair.add(seat);

  // Wooden seat apron
  const apronGeo = new THREE.CylinderGeometry(0.35, 0.33, 0.05, 20);
  const apron = new THREE.Mesh(apronGeo, woodMat);
  apron.position.y = seatY - 0.055;
  chair.add(apron);

  // 4 tapered legs
  const legGeo = new THREE.CylinderGeometry(0.024, 0.018, 0.44, 10);
  const legOffsets: readonly [number, number][] = [
    [-0.22, -0.22],
    [0.22, -0.22],
    [-0.22, 0.22],
    [0.22, 0.22],
  ];
  for (const [lx, lz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, woodMat);
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

  // Subtle woven rug under the poker table
  const rugShape = createOvalShape(3.35, 2.55, 64);
  const rugGeo = new THREE.ShapeGeometry(rugShape);
  const rugMat = createMatteMaterial(0xe5d3b7, { roughness: 0.96 });
  const rug = new THREE.Mesh(rugGeo, rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = floorY + 0.005;
  rug.receiveShadow = true;
  root.add(rug);

  const rugBorderShape = createOvalShape(3.15, 2.35, 64);
  rugBorderShape.holes.push(createOvalPath(3.03, 2.23, 64));
  const rugBorder = new THREE.Mesh(
    new THREE.ShapeGeometry(rugBorderShape),
    createMatteMaterial(0x7c5a46, { roughness: 0.95 }),
  );
  rugBorder.rotation.x = -Math.PI / 2;
  rugBorder.position.y = floorY + 0.008;
  root.add(rugBorder);

  // Back wall (-Z), Left wall (-X), Right wall (+X)
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(18, 8.5), wallMat);
  backWall.position.set(0, floorY + 4.25, -4.4);
  backWall.receiveShadow = true;
  root.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(14, 8.5), wallSideMat);
  leftWall.position.set(-5.6, floorY + 4.25, 1.0);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.receiveShadow = true;
  root.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(14, 8.5), wallSideMat);
  rightWall.position.set(5.6, floorY + 4.25, 1.0);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.receiveShadow = true;
  root.add(rightWall);

  // Back wall cream wainscoting + chair rail molding
  const wainscotBack = new THREE.Mesh(new THREE.BoxGeometry(16, 1.45, 0.08), wainscotMat);
  wainscotBack.position.set(0, floorY + 0.725, -4.36);
  wainscotBack.receiveShadow = true;
  root.add(wainscotBack);

  const chairRailBack = new THREE.Mesh(new THREE.BoxGeometry(16, 0.09, 0.13), trimMat);
  chairRailBack.position.set(0, floorY + 1.46, -4.34);
  root.add(chairRailBack);

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

  // Tasteful vintage matte framed prints on the back wall
  const frameWoodMat = createMatteMaterial(SCENE_COLORS.tableRim, { roughness: 0.8 });
  const artSpecs: readonly { x: number; suit: '♥' | '♠' | '♦'; color: string }[] = [
    { x: -2.4, suit: '♠', color: '#3E5768' },
    { x: 0, suit: '♥', color: '#C95849' },
    { x: 2.4, suit: '♦', color: '#D18244' },
  ];
  for (const spec of artSpecs) {
    const artGroup = new THREE.Group();
    artGroup.position.set(spec.x, 1.78, -4.32);

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.14, 0.06), frameWoodMat);
    frame.castShadow = true;
    artGroup.add(frame);

    const artTex = createWallArtTexture(spec.suit, spec.color);
    const canvasMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.98),
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
      emissiveIntensity: 1.1,
    }),
  );
  bulb.position.y = 0.05;
  lampGroup.add(bulb);
  root.add(lampGroup);

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
    const chair = buildChair(chairWoodMat, chairCushionMat, { lowBack: p.lowBack });
    chair.position.set(p.x, 0, p.z);
    chair.rotation.y = p.rotY;
    root.add(chair);
  }

  return root;
}
