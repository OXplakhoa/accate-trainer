import * as THREE from 'three';
import type { SceneRival } from '../contract';
import {
  getLiveCharacterPose,
  lerpCharacterPose,
  PHASE_CHARACTER_POSES,
  type CharacterPoseState,
} from './motion';
import { createMatteMaterial, SCENE_COLORS } from './palette';

export {
  getLiveCharacterPose,
  lerpCharacterPose,
  PHASE_CHARACTER_POSES,
  type CharacterPoseState,
};

export interface CharactersRig {
  readonly root: THREE.Group;
  readonly applyPose: (pose: CharacterPoseState) => void;
  readonly setOccupiedRivals: (occupiedRivals: readonly SceneRival[]) => void;
}

interface SharedRivalResources {
  readonly cuffGeo: THREE.CylinderGeometry;
  readonly palmGeo: THREE.SphereGeometry;
  readonly fingerGeo: THREE.CapsuleGeometry;
  readonly thumbGeo: THREE.CapsuleGeometry;
  readonly torsoGeo: THREE.LatheGeometry;
  readonly collarGeo: THREE.CylinderGeometry;
  readonly shirtBibGeo: THREE.BoxGeometry;
  readonly shoulderGeo: THREE.SphereGeometry;
  readonly buttonGeo: THREE.SphereGeometry;
  readonly buttonMat: THREE.MeshStandardMaterial;
  readonly scleraMat: THREE.MeshStandardMaterial;
  readonly inkMat: THREE.MeshStandardMaterial;
}

function createSharedRivalResources(): SharedRivalResources {
  const cuffGeo = new THREE.CylinderGeometry(0.045, 0.052, 0.048, 16);
  cuffGeo.rotateX(Math.PI / 2);

  const palmGeo = new THREE.SphereGeometry(0.072, 16, 14);

  const fingerGeo = new THREE.CapsuleGeometry(0.02, 0.048, 6, 8);
  fingerGeo.rotateX(Math.PI / 2 + 0.12);

  const thumbGeo = new THREE.CapsuleGeometry(0.02, 0.04, 6, 8);
  thumbGeo.rotateX(Math.PI / 2 + 0.1);

  const torsoProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.24, 0.02),
    new THREE.Vector2(0.27, 0.16),
    new THREE.Vector2(0.29, 0.36),
    new THREE.Vector2(0.25, 0.52),
    new THREE.Vector2(0.14, 0.58),
    new THREE.Vector2(0.0, 0.59),
  ];
  const torsoGeo = new THREE.LatheGeometry(torsoProfile, 24);
  const collarGeo = new THREE.CylinderGeometry(0.135, 0.165, 0.11, 18);
  const shirtBibGeo = new THREE.BoxGeometry(0.13, 0.24, 0.06);
  const shoulderGeo = new THREE.SphereGeometry(0.092, 14, 12);
  const buttonGeo = new THREE.SphereGeometry(0.016, 10, 8);

  const buttonMat = createMatteMaterial(SCENE_COLORS.tableRim, { roughness: 0.76 });
  const scleraMat = createMatteMaterial(SCENE_COLORS.ivory, { roughness: 0.65 });
  const inkMat = createMatteMaterial(SCENE_COLORS.ink, { roughness: 0.55 });

  return {
    cuffGeo,
    palmGeo,
    fingerGeo,
    thumbGeo,
    torsoGeo,
    collarGeo,
    shirtBibGeo,
    shoulderGeo,
    buttonGeo,
    buttonMat,
    scleraMat,
    inkMat,
  };
}

function createTaperedSleeveGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  tubularSegments: number,
  radialSegments: number,
  startRx: number,
  startRy: number,
  endRx: number,
  endRy: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const normalUp = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i += 1) {
    const u = i / tubularSegments;
    const smooth = u * u * (3 - 2 * u);
    const rx = startRx + (endRx - startRx) * smooth;
    const ry = startRy + (endRy - startRy) * smooth;

    const pos = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u).normalize();
    right.crossVectors(tangent, worldUp).normalize();
    normalUp.crossVectors(right, tangent).normalize();

    for (let j = 0; j <= radialSegments; j += 1) {
      const v = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(v);
      const sin = Math.sin(v);

      const vx = pos.x + right.x * (cos * rx) + normalUp.x * (sin * ry);
      const vy = pos.y + right.y * (cos * rx) + normalUp.y * (sin * ry);
      const vz = pos.z + right.z * (cos * rx) + normalUp.z * (sin * ry);
      positions.push(vx, vy, vz);

      const nx = right.x * (cos / rx) + normalUp.x * (sin / ry);
      const ny = right.y * (cos / rx) + normalUp.y * (sin / ry);
      const nz = right.z * (cos / rx) + normalUp.z * (sin / ry);
      const nLen = Math.hypot(nx, ny, nz) || 1;
      normals.push(nx / nLen, ny / nLen, nz / nLen);
    }
  }

  const stride = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

function addSculptedHand(
  parent: THREE.Group,
  shared: SharedRivalResources,
  handMat: THREE.MeshStandardMaterial,
  cuffMat: THREE.MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
  rotY: number,
  mirrorX = 1,
): void {
  const hand = new THREE.Group();
  hand.name = mirrorX > 0 ? 'RivalHandLeft' : 'RivalHandRight';
  hand.position.set(x, y, z);
  hand.rotation.y = rotY;

  // Tailored wrist cuff connecting the tapered sleeve seamlessly into the hand
  const cuff = new THREE.Mesh(shared.cuffGeo, cuffMat);
  cuff.name = mirrorX > 0 ? 'RivalCuffLeft' : 'RivalCuffRight';
  cuff.scale.set(1.08, 0.66, 1.0);
  cuff.position.set(0, 0.004, -0.054);
  cuff.castShadow = true;
  hand.add(cuff);

  // Proportionate plump stylized mitten/paw palm resting atop the rail (y_rail_top = 0.117)
  const palm = new THREE.Mesh(shared.palmGeo, handMat);
  palm.scale.set(1.12, 0.48, 1.16);
  palm.castShadow = true;
  palm.receiveShadow = true;
  hand.add(palm);

  // 3 plump sculpted finger digits resting horizontally forward on top of the rail (castShadow = false)
  for (let i = -1; i <= 1; i += 1) {
    const finger = new THREE.Mesh(shared.fingerGeo, handMat);
    finger.position.set(i * 0.041, -0.004, 0.076 - Math.abs(i) * 0.004);
    finger.rotation.y = i * 0.08;
    finger.castShadow = false;
    hand.add(finger);
  }

  // Distinct stylized thumb resting inward on the rail (castShadow = false)
  const thumb = new THREE.Mesh(shared.thumbGeo, handMat);
  thumb.position.set(-0.066 * mirrorX, -0.003, 0.024);
  thumb.rotation.y = -0.46 * mirrorX;
  thumb.castShadow = false;
  hand.add(thumb);

  parent.add(hand);
}

interface HumanoidTorsoOptions {
  readonly vestColor: number;
  readonly shirtColor: number;
  readonly sleeveColor?: number;
  readonly cuffColor?: number;
  readonly handColor: number;
  readonly tieColor?: number;
  readonly leanForward?: number;
  readonly rightArmReach?: number;
}

function buildSeatedTorso(opts: HumanoidTorsoOptions, shared: SharedRivalResources): THREE.Group {
  const body = new THREE.Group();

  const vestMat = createMatteMaterial(opts.vestColor, { roughness: 0.88 });
  const shirtMat = createMatteMaterial(opts.shirtColor, { roughness: 0.86 });
  const sleeveMat = createMatteMaterial(opts.sleeveColor ?? opts.shirtColor, { roughness: 0.87 });
  const cuffMat = createMatteMaterial(opts.cuffColor ?? opts.shirtColor, { roughness: 0.85 });
  const handMat = createMatteMaterial(opts.handColor, { roughness: 0.82 });

  const lean = opts.leanForward ?? 0;

  // Turned sculpted torso (organic rounded shoulders & waist)
  const torso = new THREE.Mesh(shared.torsoGeo, vestMat);
  torso.position.set(0, -0.24, 0);
  torso.scale.set(1.06, 1.0, 0.76);
  torso.rotation.x = lean;
  torso.castShadow = true;
  torso.receiveShadow = true;
  body.add(torso);

  // Crisp shirt collar V-front
  const collar = new THREE.Mesh(shared.collarGeo, shirtMat);
  collar.position.set(0, 0.32, 0.025 + lean * 0.15);
  collar.rotation.x = lean;
  body.add(collar);

  const shirtBib = new THREE.Mesh(shared.shirtBibGeo, shirtMat);
  shirtBib.position.set(0, 0.2, 0.18 + lean * 0.12);
  shirtBib.rotation.x = lean - 0.08;
  body.add(shirtBib);

  // Optional neat tie / cravat or vest buttons
  if (opts.tieColor !== undefined) {
    const tieMat = createMatteMaterial(opts.tieColor, { roughness: 0.86 });
    const tieKnot = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), tieMat);
    tieKnot.position.set(0, 0.27, 0.215 + lean * 0.12);
    body.add(tieKnot);

    const tieBlade = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.22, 6), tieMat);
    tieBlade.rotation.x = Math.PI;
    tieBlade.scale.set(1.0, 1.0, 0.45);
    tieBlade.position.set(0, 0.15, 0.218 + lean * 0.12);
    body.add(tieBlade);
  } else {
    for (let i = 0; i < 3; i += 1) {
      const btn = new THREE.Mesh(shared.buttonGeo, shared.buttonMat);
      btn.position.set(0, 0.19 - i * 0.085, 0.215 + lean * 0.12);
      body.add(btn);
    }
  }

  // Shoulders + tapered sleeves resting strictly above the table rail (y_rail_top = 0.117)
  // and tapering seamlessly into the wrist cuffs with zero visible step
  const handY = 0.168;
  const handXL = -0.21;
  const handZL = 0.39;
  const rotYL = 0.24;
  const armCurveL = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.27, 0.242, 0.02),
    new THREE.Vector3(-0.305, 0.204, 0.14),
    new THREE.Vector3(
      handXL - Math.sin(rotYL) * 0.14,
      0.18,
      handZL - Math.cos(rotYL) * 0.14,
    ),
    new THREE.Vector3(
      handXL - Math.sin(rotYL) * 0.066,
      handY + 0.004,
      handZL - Math.cos(rotYL) * 0.066,
    ),
  ]);
  const armMeshL = new THREE.Mesh(
    createTaperedSleeveGeometry(armCurveL, 18, 14, 0.062, 0.056, 0.0555, 0.0338),
    sleeveMat,
  );
  armMeshL.name = 'RivalSleeveLeft';
  armMeshL.castShadow = true;
  body.add(armMeshL);

  const shoulderL = new THREE.Mesh(shared.shoulderGeo, vestMat);
  shoulderL.position.set(-0.27, 0.24, 0.01);
  shoulderL.castShadow = true;
  body.add(shoulderL);

  const reachR = opts.rightArmReach ?? 0;
  const handXR = 0.195 - reachR * 0.12;
  const handZR = 0.39 + reachR;
  const rotYR = -0.24;
  const armCurveR = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.27, 0.242, 0.02),
    new THREE.Vector3(0.305, 0.204, 0.14 + reachR * 0.35),
    new THREE.Vector3(
      handXR - Math.sin(rotYR) * 0.14,
      0.18,
      handZR - Math.cos(rotYR) * 0.14,
    ),
    new THREE.Vector3(
      handXR - Math.sin(rotYR) * 0.066,
      handY + 0.004,
      handZR - Math.cos(rotYR) * 0.066,
    ),
  ]);
  const armMeshR = new THREE.Mesh(
    createTaperedSleeveGeometry(armCurveR, 18, 14, 0.062, 0.056, 0.0555, 0.0338),
    sleeveMat,
  );
  armMeshR.name = 'RivalSleeveRight';
  armMeshR.castShadow = true;
  body.add(armMeshR);

  const shoulderR = new THREE.Mesh(shared.shoulderGeo, vestMat);
  shoulderR.position.set(0.27, 0.24, 0.01);
  shoulderR.castShadow = true;
  body.add(shoulderR);

  // Hands resting naturally on top of the table rail (y = 0.168 keeps sleeve, cuff, palm & fingers > 0.117 even when leaning)
  addSculptedHand(body, shared, handMat, cuffMat, handXL, handY, handZL, rotYL, 1);
  addSculptedHand(body, shared, handMat, cuffMat, handXR, handY, handZR, rotYR, -1);

  return body;
}

function createLeanWrapper(group: THREE.Group): {
  readonly leanPivot: THREE.Group;
  readonly bodyContainer: THREE.Group;
} {
  // Pivot at the palm/rail contact zone (y = 0.166, z = 0.44) so leaning keeps hands planted on top of the rail
  const leanPivot = new THREE.Group();
  leanPivot.position.set(0, 0.166, 0.44);
  group.add(leanPivot);

  const bodyContainer = new THREE.Group();
  bodyContainer.position.set(0, -0.166, -0.44);
  leanPivot.add(bodyContainer);

  return { leanPivot, bodyContainer };
}

interface CaRig {
  readonly group: THREE.Group;
  readonly leanPivot: THREE.Group;
  readonly headPivot: THREE.Group;
  readonly lidL: THREE.Mesh;
  readonly lidR: THREE.Mesh;
}

function buildCaCharacter(shared: SharedRivalResources): CaRig {
  const group = new THREE.Group();
  group.name = 'CharacterCa';

  const { leanPivot, bodyContainer } = createLeanWrapper(group);

  const body = buildSeatedTorso(
    {
      vestColor: SCENE_COLORS.caVest,
      shirtColor: SCENE_COLORS.caShirt,
      sleeveColor: SCENE_COLORS.caShirt,
      cuffColor: SCENE_COLORS.caBlueDeep,
      handColor: SCENE_COLORS.caHand,
    },
    shared,
  );
  bodyContainer.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.42, 0.03);
  bodyContainer.add(headPivot);

  const blueMat = createMatteMaterial(SCENE_COLORS.caBlue, { roughness: 0.82 });
  const deepBlueMat = createMatteMaterial(SCENE_COLORS.caBlueDeep, { roughness: 0.8 });
  const bellyMat = createMatteMaterial(SCENE_COLORS.caBelly, { roughness: 0.85 });
  const cheekMat = createMatteMaterial(SCENE_COLORS.caCheek, { roughness: 0.86 });
  const { scleraMat, inkMat } = shared;

  // Neck transition
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.125, 0.14, 16), blueMat);
  neck.position.y = 0.02;
  headPivot.add(neck);

  // Sculpted fish cranium (plump rounded-ovoid fish head, taller & slightly compressed side-to-side)
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.245, 28, 22), blueMat);
  cranium.position.set(0, 0.2, 0.02);
  cranium.scale.set(0.95, 1.04, 1.12);
  cranium.castShadow = true;
  cranium.receiveShadow = true;
  headPivot.add(cranium);

  // Pale-sky lower jaw & chin belly patch
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.205, 24, 18), bellyMat);
  jaw.position.set(0, 0.11, 0.06);
  jaw.scale.set(0.94, 0.68, 1.04);
  headPivot.add(jaw);

  // Sculpted rounded fish lips (expressive O-snout)
  const upperLip = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.024, 12, 22), cheekMat);
  upperLip.position.set(0, 0.115, 0.265);
  upperLip.scale.set(1.18, 0.78, 0.85);
  upperLip.castShadow = true;
  headPivot.add(upperLip);

  const mouthInner = new THREE.Mesh(new THREE.SphereGeometry(0.044, 12, 10), inkMat);
  mouthInner.position.set(0, 0.115, 0.245);
  mouthInner.scale.set(1.0, 0.65, 0.5);
  headPivot.add(mouthInner);

  // Soft warm coral cheek blush medallions
  const blushGeo = new THREE.SphereGeometry(0.05, 12, 10);
  for (const sx of [-1, 1]) {
    const blush = new THREE.Mesh(blushGeo, cheekMat);
    blush.position.set(sx * 0.175, 0.14, 0.16);
    blush.scale.set(0.55, 0.72, 0.9);
    headPivot.add(blush);
  }

  // Iconic Dorsal Crest Fin along the top of the head
  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(0, 0);
  dorsalShape.quadraticCurveTo(-0.08, 0.17, 0.02, 0.24);
  dorsalShape.quadraticCurveTo(0.14, 0.22, 0.22, 0.16);
  dorsalShape.quadraticCurveTo(0.28, 0.09, 0.25, -0.02);
  dorsalShape.quadraticCurveTo(0.12, -0.03, 0, 0);
  const dorsalGeo = new THREE.ExtrudeGeometry(dorsalShape, {
    depth: 0.034,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 2,
  });
  dorsalGeo.rotateY(Math.PI / 2);
  const dorsalFin = new THREE.Mesh(dorsalGeo, deepBlueMat);
  dorsalFin.position.set(-0.017, 0.37, 0.07);
  dorsalFin.castShadow = true;
  headPivot.add(dorsalFin);

  // Twin Side Cheek / Ear Fins flaring gracefully outward
  const sideFinShape = new THREE.Shape();
  sideFinShape.moveTo(0, 0);
  sideFinShape.quadraticCurveTo(0.11, 0.08, 0.19, 0.05);
  sideFinShape.quadraticCurveTo(0.21, -0.04, 0.13, -0.11);
  sideFinShape.quadraticCurveTo(0.05, -0.1, 0, -0.03);
  const sideFinGeo = new THREE.ExtrudeGeometry(sideFinShape, {
    depth: 0.02,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2,
  });
  for (const sx of [-1, 1]) {
    const fin = new THREE.Mesh(sideFinGeo, deepBlueMat);
    fin.position.set(sx * 0.21, 0.19, -0.01);
    fin.scale.x = sx;
    fin.rotation.y = sx * -0.45;
    fin.rotation.z = sx * 0.16;
    fin.castShadow = true;
    headPivot.add(fin);
  }

  // Prominent Round Fish Eyes with subtle upper lids (shared eye geometries)
  const eyeRimGeo = new THREE.SphereGeometry(0.072, 18, 16);
  const eyeScleraGeo = new THREE.SphereGeometry(0.066, 18, 16);
  const eyePupilGeo = new THREE.SphereGeometry(0.034, 14, 12);
  const eyeGlintGeo = new THREE.SphereGeometry(0.012, 10, 8);
  const eyeLidGeo = new THREE.SphereGeometry(0.071, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.42);
  const createFishEye = (sx: number): THREE.Mesh => {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(sx * 0.14, 0.245, 0.195);

    const rim = new THREE.Mesh(eyeRimGeo, deepBlueMat);
    rim.position.z = -0.012;
    eyeGroup.add(rim);

    const sclera = new THREE.Mesh(eyeScleraGeo, scleraMat);
    eyeGroup.add(sclera);

    const pupil = new THREE.Mesh(eyePupilGeo, inkMat);
    pupil.position.set(sx * 0.008, 0.0, 0.052);
    eyeGroup.add(pupil);

    const glint = new THREE.Mesh(eyeGlintGeo, scleraMat);
    glint.position.set(sx * 0.018, 0.018, 0.074);
    eyeGroup.add(glint);

    const lid = new THREE.Mesh(eyeLidGeo, blueMat);
    lid.position.y = 0.008;
    lid.rotation.x = -0.22;
    eyeGroup.add(lid);

    headPivot.add(eyeGroup);
    return lid;
  };

  const lidL = createFishEye(-1);
  const lidR = createFishEye(1);

  return { group, leanPivot, headPivot, lidL, lidR };
}

interface CaoRig {
  readonly group: THREE.Group;
  readonly leanPivot: THREE.Group;
  readonly headPivot: THREE.Group;
  readonly browL: THREE.Mesh;
  readonly browR: THREE.Mesh;
}

function buildCaoCharacter(shared: SharedRivalResources): CaoRig {
  const group = new THREE.Group();
  group.name = 'CharacterCao';

  const { leanPivot, bodyContainer } = createLeanWrapper(group);

  const body = buildSeatedTorso(
    {
      vestColor: SCENE_COLORS.caoJacket,
      shirtColor: SCENE_COLORS.caoCream,
      sleeveColor: SCENE_COLORS.caoJacket,
      cuffColor: SCENE_COLORS.caoCream,
      handColor: SCENE_COLORS.caoPaw,
      tieColor: SCENE_COLORS.caoTie,
    },
    shared,
  );
  bodyContainer.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.42, 0.03);
  bodyContainer.add(headPivot);

  const orangeMat = createMatteMaterial(SCENE_COLORS.caoOrange, { roughness: 0.85 });
  const deepOrangeMat = createMatteMaterial(SCENE_COLORS.caoOrangeDeep, { roughness: 0.84 });
  const creamMat = createMatteMaterial(SCENE_COLORS.caoCream, { roughness: 0.87 });
  const earInnerMat = createMatteMaterial(SCENE_COLORS.caoEarInner, { roughness: 0.88 });
  const tipMat = createMatteMaterial(SCENE_COLORS.caoEarTip, { roughness: 0.82 });
  const { scleraMat, inkMat } = shared;

  // Neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.14, 16), orangeMat);
  neck.position.y = 0.02;
  headPivot.add(neck);

  // Fox head cranium (distinct diamond-cheeked fox head)
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.225, 28, 22), orangeMat);
  cranium.position.set(0, 0.21, 0.01);
  cranium.scale.set(1.08, 0.96, 1.0);
  cranium.castShadow = true;
  cranium.receiveShadow = true;
  headPivot.add(cranium);

  // Prominent cream cheek ruffs flaring gently outward (classic fox silhouette!)
  const cheekGeo = new THREE.ConeGeometry(0.12, 0.22, 12);
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(cheekGeo, creamMat);
    cheek.position.set(sx * 0.2, 0.145, 0.05);
    cheek.rotation.z = sx * -1.18;
    cheek.rotation.y = sx * 0.25;
    cheek.scale.set(0.85, 1.0, 0.68);
    cheek.castShadow = true;
    headPivot.add(cheek);
  }

  // Tapered protruding Fox Muzzle / Snout
  const snoutUpper = new THREE.Mesh(new THREE.ConeGeometry(0.125, 0.28, 18), orangeMat);
  snoutUpper.rotation.x = Math.PI / 2 + 0.08;
  snoutUpper.position.set(0, 0.175, 0.23);
  snoutUpper.scale.set(1.02, 1.0, 0.76);
  snoutUpper.castShadow = true;
  headPivot.add(snoutUpper);

  const snoutLower = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.25, 18), creamMat);
  snoutLower.rotation.x = Math.PI / 2 + 0.03;
  snoutLower.position.set(0, 0.14, 0.22);
  snoutLower.scale.set(1.04, 1.0, 0.62);
  headPivot.add(snoutLower);

  // Matte charcoal triangular fox button nose
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 12), tipMat);
  nose.position.set(0, 0.165, 0.365);
  nose.scale.set(1.15, 0.85, 0.85);
  headPivot.add(nose);

  // Subtle smirk curve under snout
  const smirkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.06, 0.12, 0.295),
    new THREE.Vector3(0.0, 0.112, 0.325),
    new THREE.Vector3(0.065, 0.126, 0.295),
  ]);
  const smirk = new THREE.Mesh(new THREE.TubeGeometry(smirkCurve, 12, 0.008, 8, false), tipMat);
  headPivot.add(smirk);

  // Tall Pointed Fox Ears with charcoal tips and warm inner panels
  const earShape = new THREE.Shape();
  earShape.moveTo(-0.095, 0);
  earShape.quadraticCurveTo(-0.085, 0.18, 0.0, 0.31);
  earShape.quadraticCurveTo(0.085, 0.18, 0.095, 0);
  earShape.closePath();

  const earGeo = new THREE.ExtrudeGeometry(earShape, {
    depth: 0.036,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.01,
    bevelSegments: 2,
  });

  const innerEarShape = new THREE.Shape();
  innerEarShape.moveTo(-0.056, 0.02);
  innerEarShape.quadraticCurveTo(-0.045, 0.14, 0.0, 0.22);
  innerEarShape.quadraticCurveTo(0.045, 0.14, 0.056, 0.02);
  innerEarShape.closePath();
  const innerEarGeo = new THREE.ShapeGeometry(innerEarShape);

  const tipGeo = new THREE.ConeGeometry(0.046, 0.11, 10);

  for (const sx of [-1, 1]) {
    const earGroup = new THREE.Group();
    earGroup.position.set(sx * 0.135, 0.345, -0.015);
    earGroup.rotation.z = sx * -0.24;
    earGroup.rotation.y = sx * 0.18;
    earGroup.rotation.x = 0.08;

    const outer = new THREE.Mesh(earGeo, orangeMat);
    outer.position.z = -0.018;
    outer.castShadow = true;
    earGroup.add(outer);

    const inner = new THREE.Mesh(innerEarGeo, earInnerMat);
    inner.position.z = 0.032;
    earGroup.add(inner);

    const earTip = new THREE.Mesh(tipGeo, tipMat);
    earTip.position.set(0, 0.275, 0.0);
    earTip.scale.set(1.0, 1.0, 0.52);
    earGroup.add(earTip);

    headPivot.add(earGroup);
  }

  // Sly expressive Fox Eyes + angled eyebrows (shared eye geometries)
  const browGeo = new THREE.CapsuleGeometry(0.014, 0.08, 6, 8);
  const eyeScleraGeo = new THREE.SphereGeometry(0.046, 16, 14);
  const eyePupilGeo = new THREE.SphereGeometry(0.026, 12, 10);
  const eyeGlintGeo = new THREE.SphereGeometry(0.008, 8, 8);
  const brows: THREE.Mesh[] = [];

  for (const sx of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(sx * 0.095, 0.24, 0.185);
    eyeGroup.rotation.y = sx * 0.24;

    const sclera = new THREE.Mesh(eyeScleraGeo, scleraMat);
    sclera.scale.set(1.18, 0.78, 0.72);
    eyeGroup.add(sclera);

    const pupil = new THREE.Mesh(eyePupilGeo, inkMat);
    pupil.position.set(0, -0.002, 0.028);
    pupil.scale.set(0.82, 1.05, 0.7);
    eyeGroup.add(pupil);

    const glint = new THREE.Mesh(eyeGlintGeo, scleraMat);
    glint.position.set(0.01, 0.01, 0.044);
    eyeGroup.add(glint);

    headPivot.add(eyeGroup);

    const brow = new THREE.Mesh(browGeo, deepOrangeMat);
    brow.position.set(sx * 0.095, 0.295, 0.205);
    brow.rotation.z = Math.PI / 2 + sx * 0.22;
    brow.rotation.y = sx * 0.22;
    headPivot.add(brow);
    brows.push(brow);
  }

  const browL = brows[0] as THREE.Mesh;
  const browR = brows[1] as THREE.Mesh;

  return { group, leanPivot, headPivot, browL, browR };
}

interface NongRig {
  readonly group: THREE.Group;
  readonly leanPivot: THREE.Group;
  readonly headPivot: THREE.Group;
  readonly lidPivot: THREE.Group;
  readonly steamGroup: THREE.Group;
  readonly browL: THREE.Mesh;
  readonly browR: THREE.Mesh;
}

function buildNongCharacter(shared: SharedRivalResources): NongRig {
  const group = new THREE.Group();
  group.name = 'CharacterNong';

  const { leanPivot, bodyContainer } = createLeanWrapper(group);

  const body = buildSeatedTorso(
    {
      vestColor: SCENE_COLORS.nongVest,
      shirtColor: SCENE_COLORS.nongSweater,
      sleeveColor: SCENE_COLORS.nongSweater,
      cuffColor: SCENE_COLORS.nongStripe,
      handColor: SCENE_COLORS.nongHand,
      leanForward: 0.08,
      rightArmReach: 0.06,
    },
    shared,
  );
  bodyContainer.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.42, 0.04);
  bodyContainer.add(headPivot);

  const kettleMat = createMatteMaterial(SCENE_COLORS.nongRed, { roughness: 0.74, metalness: 0.06 });
  const kettleDeepMat = createMatteMaterial(SCENE_COLORS.nongRedDeep, {
    roughness: 0.78,
    metalness: 0.06,
  });
  const stripeMat = createMatteMaterial(SCENE_COLORS.nongStripe, { roughness: 0.84 });
  const brassMat = createMatteMaterial(SCENE_COLORS.nongBrass, {
    roughness: 0.56,
    metalness: 0.22,
  });
  const handleWoodMat = createMatteMaterial(SCENE_COLORS.nongHandleWood, { roughness: 0.8 });
  const steamMat = createMatteMaterial(SCENE_COLORS.nongSteam, {
    roughness: 0.94,
    transparent: true,
    opacity: 0.9,
  });
  const { scleraMat, inkMat } = shared;

  // Matte kettle collar neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.135, 0.12, 18), brassMat);
  neck.position.y = 0.015;
  headPivot.add(neck);

  // Sculpted Turned Tea-Kettle Head Body (LatheGeometry)
  const kettleProfile = [
    new THREE.Vector2(0.0, 0.04),
    new THREE.Vector2(0.17, 0.04),
    new THREE.Vector2(0.255, 0.12),
    new THREE.Vector2(0.275, 0.22),
    new THREE.Vector2(0.245, 0.33),
    new THREE.Vector2(0.185, 0.41),
    new THREE.Vector2(0.165, 0.43),
    new THREE.Vector2(0.145, 0.43),
  ];
  const kettleGeo = new THREE.LatheGeometry(kettleProfile, 32);
  const kettleBody = new THREE.Mesh(kettleGeo, kettleMat);
  kettleBody.castShadow = true;
  kettleBody.receiveShadow = true;
  headPivot.add(kettleBody);

  // Decorative cream & brass horizontal enamel belly band
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.272, 0.264, 0.044, 32, 1, true), stripeMat);
  band.position.y = 0.155;
  headPivot.add(band);

  const rimCollar = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.015, 10, 28), brassMat);
  rimCollar.rotation.x = Math.PI / 2;
  rimCollar.position.y = 0.425;
  headPivot.add(rimCollar);

  // Domed Pivoting Kettle Lid + Finial Knob
  const lidPivot = new THREE.Group();
  lidPivot.position.set(-0.15, 0.43, 0);
  headPivot.add(lidPivot);

  const lidProfile = [
    new THREE.Vector2(0.0, 0.085),
    new THREE.Vector2(0.04, 0.08),
    new THREE.Vector2(0.11, 0.055),
    new THREE.Vector2(0.162, 0.012),
    new THREE.Vector2(0.162, 0.0),
  ];
  const lidMesh = new THREE.Mesh(new THREE.LatheGeometry(lidProfile, 26), kettleDeepMat);
  lidMesh.position.x = 0.15;
  lidMesh.castShadow = true;
  lidPivot.add(lidMesh);

  const knobStem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.045, 12), brassMat);
  knobStem.position.set(0.15, 0.095, 0);
  lidPivot.add(knobStem);

  const knobTop = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), handleWoodMat);
  knobTop.position.set(0.15, 0.125, 0);
  knobTop.scale.set(1.15, 0.78, 1.15);
  knobTop.castShadow = true;
  lidPivot.add(knobTop);

  // Iconic Curved Pouring Spout on the kettle's right silhouette (+X in local space -> outer right-front in world space!)
  const spoutCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.22, 0.17, 0.02),
    new THREE.Vector3(0.32, 0.21, 0.03),
    new THREE.Vector3(0.38, 0.34, 0.03),
    new THREE.Vector3(0.45, 0.41, 0.03),
  ]);
  const spout = new THREE.Mesh(new THREE.TubeGeometry(spoutCurve, 22, 0.046, 14, false), kettleMat);
  spout.castShadow = true;
  headPivot.add(spout);

  const spoutTip = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.012, 10, 18), brassMat);
  spoutTip.position.set(0.455, 0.412, 0.03);
  spoutTip.rotation.y = Math.PI / 2;
  spoutTip.rotation.x = -0.6;
  headPivot.add(spoutTip);

  // Sweeping Overhead Kettle Arch Handle + Cocoa Wooden Grip
  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.22, 0.33, 0),
    new THREE.Vector3(-0.24, 0.56, 0),
    new THREE.Vector3(0.0, 0.65, 0),
    new THREE.Vector3(0.24, 0.56, 0),
    new THREE.Vector3(0.22, 0.33, 0),
  ]);
  const handleArch = new THREE.Mesh(
    new THREE.TubeGeometry(handleCurve, 26, 0.022, 10, false),
    brassMat,
  );
  handleArch.castShadow = true;
  headPivot.add(handleArch);

  const handleGrip = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.18, 8, 12), handleWoodMat);
  handleGrip.rotation.z = Math.PI / 2;
  handleGrip.position.set(0, 0.648, 0);
  handleGrip.castShadow = true;
  headPivot.add(handleGrip);

  // Stylized Matte Sculpted Steam Puffs emerging from the spout
  const steamGroup = new THREE.Group();
  steamGroup.position.set(0.47, 0.45, 0.03);
  headPivot.add(steamGroup);

  const puffSpecs: readonly { x: number; y: number; z: number; r: number }[] = [
    { x: 0.03, y: 0.03, z: 0.0, r: 0.042 },
    { x: 0.09, y: 0.09, z: 0.01, r: 0.062 },
    { x: 0.05, y: 0.14, z: -0.02, r: 0.052 },
    { x: 0.14, y: 0.17, z: 0.0, r: 0.075 },
  ];
  for (const puff of puffSpecs) {
    const pMesh = new THREE.Mesh(new THREE.SphereGeometry(puff.r, 14, 12), steamMat);
    pMesh.position.set(puff.x, puff.y, puff.z);
    steamGroup.add(pMesh);
  }

  // Expressive Face sculpted onto the front (+Z) belly of the kettle (shared eye geometries)
  const brows: THREE.Mesh[] = [];
  const browGeo = new THREE.CapsuleGeometry(0.017, 0.088, 6, 8);
  const eyeScleraGeo = new THREE.SphereGeometry(0.048, 16, 14);
  const eyePupilGeo = new THREE.SphereGeometry(0.025, 12, 10);
  const eyeGlintGeo = new THREE.SphereGeometry(0.009, 8, 8);
  for (const sx of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(sx * 0.088, 0.255, 0.242);
    eyeGroup.rotation.y = sx * 0.28;

    const sclera = new THREE.Mesh(eyeScleraGeo, scleraMat);
    sclera.scale.set(1.05, 0.96, 0.56);
    eyeGroup.add(sclera);

    const pupil = new THREE.Mesh(eyePupilGeo, inkMat);
    pupil.position.set(0, 0, 0.024);
    eyeGroup.add(pupil);

    const glint = new THREE.Mesh(eyeGlintGeo, scleraMat);
    glint.position.set(0.008, 0.01, 0.044);
    eyeGroup.add(glint);

    headPivot.add(eyeGroup);

    const brow = new THREE.Mesh(browGeo, inkMat);
    brow.position.set(sx * 0.09, 0.315, 0.245);
    brow.rotation.z = Math.PI / 2;
    brow.rotation.y = sx * 0.26;
    headPivot.add(brow);
    brows.push(brow);
  }

  // Determined kettle mouth
  const mouthCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.055, 0.185, 0.255),
    new THREE.Vector3(0.0, 0.194, 0.268),
    new THREE.Vector3(0.055, 0.185, 0.255),
  ]);
  const mouth = new THREE.Mesh(new THREE.TubeGeometry(mouthCurve, 12, 0.011, 8, false), inkMat);
  headPivot.add(mouth);

  const browL = brows[0] as THREE.Mesh;
  const browR = brows[1] as THREE.Mesh;

  return { group, leanPivot, headPivot, lidPivot, steamGroup, browL, browR };
}

function buildHeroPresence(): THREE.Group {
  const hero = new THREE.Group();
  hero.name = 'HeroPresence';

  // Hero sits at the near edge (+Z), with tapered sleeves extending outward past the outer rail edge
  // toward Hero's body, knitted cuffs, and proportionate hands resting cleanly ON TOP OF the wooden rail
  // (y_rail_top = 0.117 -> every mesh min.y >= 0.125) without obstructing cards, pot, call or board.
  const sleeveMat = createMatteMaterial(SCENE_COLORS.heroSleeve, { roughness: 0.88 });
  const cuffMat = createMatteMaterial(SCENE_COLORS.heroCuff, { roughness: 0.86 });
  const skinMat = createMatteMaterial(SCENE_COLORS.heroSkin, { roughness: 0.82 });

  // Shared tapered sleeve geometry curving smoothly down outside the outer rail edge (z_local < -0.30)
  // toward Hero's seated body, while staying strictly above the rail plateau over the rail
  const heroSleeveCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.24, -0.62),
    new THREE.Vector3(0, -0.05, -0.44),
    new THREE.Vector3(0, 0.004, -0.28),
    new THREE.Vector3(0, 0.004, -0.14),
    new THREE.Vector3(0, 0.0, -0.026),
  ]);
  const sleeveGeo = createTaperedSleeveGeometry(
    heroSleeveCurve,
    22,
    18,
    0.066,
    0.046,
    0.0524,
    0.0276,
  );

  // Shared knitted cuff profile seamlessly continuing the sleeve taper into the wrist
  const cuffProfile = [
    new THREE.Vector2(0.0, -0.028),
    new THREE.Vector2(0.046, -0.028),
    new THREE.Vector2(0.047, -0.016),
    new THREE.Vector2(0.042, 0.01),
    new THREE.Vector2(0.037, 0.014),
    new THREE.Vector2(0.0, 0.014),
  ];
  const cuffGeo = new THREE.LatheGeometry(cuffProfile, 18);
  cuffGeo.rotateX(Math.PI / 2);

  const wristGeo = new THREE.CylinderGeometry(0.036, 0.04, 0.038, 16);
  wristGeo.rotateX(Math.PI / 2);

  const palmGeo = new THREE.SphereGeometry(0.056, 16, 14);
  const fingerLengths: readonly number[] = [0.044, 0.051, 0.048, 0.039];
  const fingerGeos = fingerLengths.map((len) => {
    const geo = new THREE.CapsuleGeometry(0.012, len, 6, 8);
    geo.rotateX(Math.PI / 2 + 0.08);
    return geo;
  });
  const thumbGeo = new THREE.CapsuleGeometry(0.013, 0.038, 6, 8);
  thumbGeo.rotateX(Math.PI / 2 + 0.06);

  for (const sx of [-1, 1]) {
    const armGroup = new THREE.Group();
    armGroup.name = sx < 0 ? 'HeroArmLeft' : 'HeroArmRight';
    // Level with the rail plateau (y = 0.122 > 0.117 rail top), extending from beyond the outer rail edge inward
    armGroup.position.set(sx * 0.54, 0.122, 1.3);
    armGroup.rotation.y = Math.PI - sx * 0.26;

    const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
    sleeve.name = 'HeroSleeve';
    sleeve.position.set(0, 0.038, 0);
    sleeve.castShadow = true;
    sleeve.receiveShadow = true;
    armGroup.add(sleeve);

    const cuff = new THREE.Mesh(cuffGeo, cuffMat);
    cuff.name = 'HeroCuff';
    cuff.scale.set(1.14, 0.6, 1.0);
    cuff.position.set(0, 0.038, 0);
    cuff.castShadow = true;
    armGroup.add(cuff);

    const wrist = new THREE.Mesh(wristGeo, skinMat);
    wrist.name = 'HeroWrist';
    wrist.scale.set(1.1, 0.58, 1.0);
    wrist.position.set(0, 0.033, 0.024);
    wrist.castShadow = true;
    armGroup.add(wrist);

    const palm = new THREE.Mesh(palmGeo, skinMat);
    palm.name = 'HeroPalm';
    palm.scale.set(1.08, 0.46, 1.15);
    palm.position.set(0, 0.028, 0.068);
    palm.castShadow = true;
    palm.receiveShadow = true;
    armGroup.add(palm);

    // 4 distinct readable fingers resting on the rail top (castShadow = false)
    for (let i = 0; i < 4; i += 1) {
      const lateral = (-1.5 + i) * sx;
      const len = fingerLengths[i] ?? 0.044;
      const finger = new THREE.Mesh(fingerGeos[i], skinMat);
      finger.name = `HeroFinger${i}`;
      finger.position.set(lateral * 0.024, 0.019, 0.118 + (len - 0.044) * 0.45);
      finger.rotation.y = lateral * 0.055;
      finger.castShadow = false;
      armGroup.add(finger);
    }

    // Inner articulated thumb (castShadow = false)
    const thumb = new THREE.Mesh(thumbGeo, skinMat);
    thumb.name = 'HeroThumb';
    thumb.position.set(-sx * 0.056, 0.02, 0.07);
    thumb.rotation.y = -sx * 0.48;
    thumb.castShadow = false;
    armGroup.add(thumb);

    hero.add(armGroup);
  }

  return hero;
}

export function buildCharacters(): CharactersRig {
  const root = new THREE.Group();
  root.name = 'Characters';

  const shared = createSharedRivalResources();

  const ca = buildCaCharacter(shared);
  ca.group.position.set(-1.82, 0, -1.14);
  ca.group.rotation.y = 0.92;
  root.add(ca.group);

  const cao = buildCaoCharacter(shared);
  cao.group.position.set(0.0, 0, -1.72);
  cao.group.rotation.y = 0.0;
  root.add(cao.group);

  const nong = buildNongCharacter(shared);
  nong.group.position.set(1.82, 0, -1.14);
  nong.group.rotation.y = -0.92;
  root.add(nong.group);

  const hero = buildHeroPresence();
  root.add(hero);

  const applyPose = (pose: CharacterPoseState) => {
    // Cá
    ca.leanPivot.rotation.x = pose.caLean;
    ca.headPivot.rotation.y = pose.caHeadRotY;
    ca.headPivot.rotation.x = pose.caHeadRotX;
    ca.lidL.position.y = 0.008 + pose.caLidOffset;
    ca.lidR.position.y = 0.008 + pose.caLidOffset;

    // Cáo
    cao.leanPivot.rotation.x = pose.caoLean;
    cao.headPivot.rotation.y = pose.caoHeadRotY;
    cao.headPivot.rotation.x = pose.caoHeadRotX;
    cao.browL.position.y = 0.295 + pose.caoBrowLift;
    cao.browR.position.y = 0.295 + pose.caoBrowLift;

    // Nóng
    nong.leanPivot.rotation.x = pose.nongLean;
    nong.headPivot.rotation.y = pose.nongHeadRotY;
    nong.headPivot.rotation.x = pose.nongHeadRotX;
    nong.lidPivot.rotation.z = pose.nongLidTilt;
    nong.steamGroup.scale.setScalar(pose.nongSteamScale);
    nong.browL.rotation.z = Math.PI / 2 - pose.nongBrowTilt;
    nong.browR.rotation.z = Math.PI / 2 + pose.nongBrowTilt;
  };

  const setOccupiedRivals = (occupiedRivals: readonly SceneRival[]) => {
    const occupied = new Set<SceneRival>(occupiedRivals);
    ca.group.visible = occupied.has('ca');
    cao.group.visible = occupied.has('cao');
    nong.group.visible = occupied.has('nong');
  };

  applyPose(PHASE_CHARACTER_POSES.arrival);

  return { root, applyPose, setOccupiedRivals };
}
