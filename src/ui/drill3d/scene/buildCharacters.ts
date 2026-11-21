import * as THREE from 'three';
import type { ScenePhase } from '../contract';
import { createMatteMaterial, SCENE_COLORS } from './palette';

export interface CharacterPoseState {
  readonly caHeadRotY: number;
  readonly caHeadRotX: number;
  readonly caLidOffset: number;
  readonly caoHeadRotY: number;
  readonly caoHeadRotX: number;
  readonly caoBrowLift: number;
  readonly nongHeadRotY: number;
  readonly nongHeadRotX: number;
  readonly nongLidTilt: number;
  readonly nongSteamScale: number;
  readonly nongBrowTilt: number;
}

export interface CharactersRig {
  readonly root: THREE.Group;
  readonly applyPose: (pose: CharacterPoseState) => void;
}

export const PHASE_CHARACTER_POSES: Record<ScenePhase, CharacterPoseState> = {
  arrival: {
    caHeadRotY: 0.06,
    caHeadRotX: -0.02,
    caLidOffset: 0.0,
    caoHeadRotY: -0.05,
    caoHeadRotX: 0.03,
    caoBrowLift: 0.0,
    nongHeadRotY: -0.05,
    nongHeadRotX: 0.02,
    nongLidTilt: 0.02,
    nongSteamScale: 0.65,
    nongBrowTilt: 0.16,
  },
  decision: {
    caHeadRotY: 0.14,
    caHeadRotX: 0.08,
    caLidOffset: -0.01,
    caoHeadRotY: 0.02,
    caoHeadRotX: 0.09,
    caoBrowLift: -0.012,
    nongHeadRotY: -0.1,
    nongHeadRotX: 0.08,
    nongLidTilt: 0.08,
    nongSteamScale: 1.0,
    nongBrowTilt: 0.3,
  },
  review: {
    caHeadRotY: 0.22,
    caHeadRotX: -0.05,
    caLidOffset: 0.024,
    caoHeadRotY: -0.14,
    caoHeadRotX: -0.04,
    caoBrowLift: 0.026,
    nongHeadRotY: -0.16,
    nongHeadRotX: -0.06,
    nongLidTilt: 0.28,
    nongSteamScale: 1.45,
    nongBrowTilt: -0.12,
  },
};

export function lerpCharacterPose(
  from: CharacterPoseState,
  to: CharacterPoseState,
  t: number,
): CharacterPoseState {
  const l = (a: number, b: number) => a + (b - a) * t;
  return {
    caHeadRotY: l(from.caHeadRotY, to.caHeadRotY),
    caHeadRotX: l(from.caHeadRotX, to.caHeadRotX),
    caLidOffset: l(from.caLidOffset, to.caLidOffset),
    caoHeadRotY: l(from.caoHeadRotY, to.caoHeadRotY),
    caoHeadRotX: l(from.caoHeadRotX, to.caoHeadRotX),
    caoBrowLift: l(from.caoBrowLift, to.caoBrowLift),
    nongHeadRotY: l(from.nongHeadRotY, to.nongHeadRotY),
    nongHeadRotX: l(from.nongHeadRotX, to.nongHeadRotX),
    nongLidTilt: l(from.nongLidTilt, to.nongLidTilt),
    nongSteamScale: l(from.nongSteamScale, to.nongSteamScale),
    nongBrowTilt: l(from.nongBrowTilt, to.nongBrowTilt),
  };
}

function addSculptedHand(
  parent: THREE.Group,
  handMat: THREE.MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
  rotY: number,
  mirrorX = 1,
): void {
  const hand = new THREE.Group();
  hand.position.set(x, y, z);
  hand.rotation.y = rotY;

  // Rounded palm
  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 12), handMat);
  palm.scale.set(1.05, 0.56, 1.15);
  palm.castShadow = true;
  hand.add(palm);

  // 3 sculpted finger forms curved gently downward
  const fingerGeo = new THREE.CapsuleGeometry(0.017, 0.045, 6, 8);
  for (let i = -1; i <= 1; i += 1) {
    const finger = new THREE.Mesh(fingerGeo, handMat);
    finger.position.set(i * 0.032, -0.008, 0.066);
    finger.rotation.x = Math.PI * 0.44;
    finger.castShadow = true;
    hand.add(finger);
  }

  // Thumb
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.034, 6, 8), handMat);
  thumb.position.set(-0.055 * mirrorX, -0.006, 0.02);
  thumb.rotation.z = 0.7 * mirrorX;
  thumb.rotation.x = 0.55;
  hand.add(thumb);

  parent.add(hand);
}

interface HumanoidTorsoOptions {
  readonly vestColor: number;
  readonly shirtColor: number;
  readonly handColor: number;
  readonly tieColor?: number;
  readonly leanForward?: number;
  readonly rightArmReach?: number;
}

function buildSeatedTorso(opts: HumanoidTorsoOptions): THREE.Group {
  const body = new THREE.Group();

  const vestMat = createMatteMaterial(opts.vestColor, { roughness: 0.88 });
  const shirtMat = createMatteMaterial(opts.shirtColor, { roughness: 0.86 });
  const handMat = createMatteMaterial(opts.handColor, { roughness: 0.84 });
  const buttonMat = createMatteMaterial(SCENE_COLORS.tableRim, { roughness: 0.76 });

  const lean = opts.leanForward ?? 0;

  // Turned sculpted torso (organic rounded shoulders & waist)
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
  const torso = new THREE.Mesh(torsoGeo, vestMat);
  torso.position.set(0, -0.24, 0);
  torso.scale.set(1.06, 1.0, 0.76);
  torso.rotation.x = lean;
  torso.castShadow = true;
  torso.receiveShadow = true;
  body.add(torso);

  // Crisp shirt collar V-front
  const collarGeo = new THREE.CylinderGeometry(0.135, 0.165, 0.11, 18);
  const collar = new THREE.Mesh(collarGeo, shirtMat);
  collar.position.set(0, 0.32, 0.025 + lean * 0.15);
  collar.rotation.x = lean;
  body.add(collar);

  const shirtBib = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.24, 0.06), shirtMat);
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
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), buttonMat);
      btn.position.set(0, 0.19 - i * 0.085, 0.215 + lean * 0.12);
      body.add(btn);
    }
  }

  // Shoulders + curved arms resting forward onto/over the poker table rail
  const armCurveL = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.27, 0.23, 0.02),
    new THREE.Vector3(-0.34, 0.1, 0.15),
    new THREE.Vector3(-0.25, 0.095, 0.34),
  ]);
  const armMeshL = new THREE.Mesh(new THREE.TubeGeometry(armCurveL, 18, 0.068, 12, false), shirtMat);
  armMeshL.castShadow = true;
  body.add(armMeshL);

  const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.092, 14, 12), vestMat);
  shoulderL.position.set(-0.27, 0.23, 0.01);
  shoulderL.castShadow = true;
  body.add(shoulderL);

  const reachR = opts.rightArmReach ?? 0;
  const armCurveR = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.27, 0.23, 0.02),
    new THREE.Vector3(0.34, 0.1, 0.15 + reachR * 0.35),
    new THREE.Vector3(0.23 - reachR * 0.1, 0.092, 0.34 + reachR),
  ]);
  const armMeshR = new THREE.Mesh(new THREE.TubeGeometry(armCurveR, 18, 0.068, 12, false), shirtMat);
  armMeshR.castShadow = true;
  body.add(armMeshR);

  const shoulderR = new THREE.Mesh(new THREE.SphereGeometry(0.092, 14, 12), vestMat);
  shoulderR.position.set(0.27, 0.23, 0.01);
  shoulderR.castShadow = true;
  body.add(shoulderR);

  // Hands resting naturally on the table edge
  addSculptedHand(body, handMat, -0.22, 0.09, 0.39, 0.25, 1);
  addSculptedHand(body, handMat, 0.2 - reachR * 0.12, 0.088, 0.39 + reachR, -0.25, -1);

  return body;
}

interface CaRig {
  readonly group: THREE.Group;
  readonly headPivot: THREE.Group;
  readonly lidL: THREE.Mesh;
  readonly lidR: THREE.Mesh;
}

function buildCaCharacter(): CaRig {
  const group = new THREE.Group();
  group.name = 'CharacterCa';

  const body = buildSeatedTorso({
    vestColor: SCENE_COLORS.caVest,
    shirtColor: SCENE_COLORS.caShirt,
    handColor: SCENE_COLORS.caBlue,
  });
  group.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.42, 0.03);
  group.add(headPivot);

  const blueMat = createMatteMaterial(SCENE_COLORS.caBlue, { roughness: 0.82 });
  const deepBlueMat = createMatteMaterial(SCENE_COLORS.caBlueDeep, { roughness: 0.8 });
  const bellyMat = createMatteMaterial(SCENE_COLORS.caBelly, { roughness: 0.85 });
  const cheekMat = createMatteMaterial(SCENE_COLORS.caCheek, { roughness: 0.86 });
  const scleraMat = createMatteMaterial(SCENE_COLORS.ivory, { roughness: 0.65 });
  const inkMat = createMatteMaterial(SCENE_COLORS.ink, { roughness: 0.55 });

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
  for (const sx of [-1, 1]) {
    const blush = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), cheekMat);
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

  // Prominent Round Fish Eyes with subtle upper lids
  const createFishEye = (sx: number): THREE.Mesh => {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(sx * 0.14, 0.245, 0.195);

    const rim = new THREE.Mesh(new THREE.SphereGeometry(0.072, 18, 16), deepBlueMat);
    rim.position.z = -0.012;
    eyeGroup.add(rim);

    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.066, 18, 16), scleraMat);
    eyeGroup.add(sclera);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 12), inkMat);
    pupil.position.set(sx * 0.008, 0.0, 0.052);
    eyeGroup.add(pupil);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), scleraMat);
    glint.position.set(sx * 0.018, 0.018, 0.074);
    eyeGroup.add(glint);

    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(0.071, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
      blueMat,
    );
    lid.position.y = 0.008;
    lid.rotation.x = -0.22;
    eyeGroup.add(lid);

    headPivot.add(eyeGroup);
    return lid;
  };

  const lidL = createFishEye(-1);
  const lidR = createFishEye(1);

  return { group, headPivot, lidL, lidR };
}

interface CaoRig {
  readonly group: THREE.Group;
  readonly headPivot: THREE.Group;
  readonly browL: THREE.Mesh;
  readonly browR: THREE.Mesh;
}

function buildCaoCharacter(): CaoRig {
  const group = new THREE.Group();
  group.name = 'CharacterCao';

  const body = buildSeatedTorso({
    vestColor: SCENE_COLORS.caoJacket,
    shirtColor: SCENE_COLORS.caoCream,
    handColor: SCENE_COLORS.caoOrange,
    tieColor: SCENE_COLORS.caoTie,
  });
  group.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.42, 0.03);
  group.add(headPivot);

  const orangeMat = createMatteMaterial(SCENE_COLORS.caoOrange, { roughness: 0.85 });
  const deepOrangeMat = createMatteMaterial(SCENE_COLORS.caoOrangeDeep, { roughness: 0.84 });
  const creamMat = createMatteMaterial(SCENE_COLORS.caoCream, { roughness: 0.87 });
  const earInnerMat = createMatteMaterial(SCENE_COLORS.caoEarInner, { roughness: 0.88 });
  const tipMat = createMatteMaterial(SCENE_COLORS.caoEarTip, { roughness: 0.82 });
  const scleraMat = createMatteMaterial(SCENE_COLORS.ivory, { roughness: 0.65 });
  const inkMat = createMatteMaterial(SCENE_COLORS.ink, { roughness: 0.55 });

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
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 12), creamMat);
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

  // Sly expressive Fox Eyes + angled eyebrows
  const browGeo = new THREE.CapsuleGeometry(0.014, 0.08, 6, 8);
  const brows: THREE.Mesh[] = [];

  for (const sx of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(sx * 0.095, 0.24, 0.185);
    eyeGroup.rotation.y = sx * 0.24;

    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.046, 16, 14), scleraMat);
    sclera.scale.set(1.18, 0.78, 0.72);
    eyeGroup.add(sclera);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), inkMat);
    pupil.position.set(0, -0.002, 0.028);
    pupil.scale.set(0.82, 1.05, 0.7);
    eyeGroup.add(pupil);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), scleraMat);
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

  return { group, headPivot, browL, browR };
}

interface NongRig {
  readonly group: THREE.Group;
  readonly headPivot: THREE.Group;
  readonly lidPivot: THREE.Group;
  readonly steamGroup: THREE.Group;
  readonly browL: THREE.Mesh;
  readonly browR: THREE.Mesh;
}

function buildNongCharacter(): NongRig {
  const group = new THREE.Group();
  group.name = 'CharacterNong';

  const body = buildSeatedTorso({
    vestColor: SCENE_COLORS.nongVest,
    shirtColor: SCENE_COLORS.nongSweater,
    handColor: SCENE_COLORS.nongRed,
    leanForward: 0.08,
    rightArmReach: 0.14,
  });
  group.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.42, 0.04);
  group.add(headPivot);

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
  const scleraMat = createMatteMaterial(SCENE_COLORS.ivory, { roughness: 0.65 });
  const inkMat = createMatteMaterial(SCENE_COLORS.ink, { roughness: 0.55 });

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

  // Expressive Face sculpted onto the front (+Z) belly of the kettle
  const brows: THREE.Mesh[] = [];
  const browGeo = new THREE.CapsuleGeometry(0.017, 0.088, 6, 8);
  for (const sx of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(sx * 0.088, 0.255, 0.242);
    eyeGroup.rotation.y = sx * 0.28;

    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.048, 16, 14), scleraMat);
    sclera.scale.set(1.05, 0.96, 0.56);
    eyeGroup.add(sclera);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 10), inkMat);
    pupil.position.set(0, 0, 0.024);
    eyeGroup.add(pupil);

    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 8), scleraMat);
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

  return { group, headPivot, lidPivot, steamGroup, browL, browR };
}

function buildHeroPresence(): THREE.Group {
  const hero = new THREE.Group();
  hero.name = 'HeroPresence';

  // Hero sits at the near edge (+Z), represented by subtle resting cuffs/forearms at the corners
  // of the near rail so the near seat feels grounded without obstructing cards or camera sightlines.
  const sleeveMat = createMatteMaterial(SCENE_COLORS.heroSleeve, { roughness: 0.88 });
  const cuffMat = createMatteMaterial(SCENE_COLORS.heroCuff, { roughness: 0.86 });
  const skinMat = createMatteMaterial(SCENE_COLORS.heroSkin, { roughness: 0.84 });

  for (const sx of [-1, 1]) {
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.28, 8, 12), sleeveMat);
    forearm.position.set(sx * 0.72, 0.095, 1.36);
    forearm.rotation.x = Math.PI / 2 - 0.12;
    forearm.rotation.z = sx * 0.35;
    forearm.castShadow = true;
    hero.add(forearm);

    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.066, 0.05, 14), cuffMat);
    cuff.position.set(sx * 0.63, 0.105, 1.2);
    cuff.rotation.x = Math.PI / 2 - 0.12;
    cuff.rotation.z = sx * 0.35;
    hero.add(cuff);

    addSculptedHand(hero, skinMat, sx * 0.57, 0.095, 1.11, Math.PI - sx * 0.35, -sx);
  }

  return hero;
}

export function buildCharacters(): CharactersRig {
  const root = new THREE.Group();
  root.name = 'Characters';

  const ca = buildCaCharacter();
  ca.group.position.set(-1.82, 0, -1.14);
  ca.group.rotation.y = 0.92;
  root.add(ca.group);

  const cao = buildCaoCharacter();
  cao.group.position.set(0.0, 0, -1.72);
  cao.group.rotation.y = 0.0;
  root.add(cao.group);

  const nong = buildNongCharacter();
  nong.group.position.set(1.82, 0, -1.14);
  nong.group.rotation.y = -0.92;
  root.add(nong.group);

  const hero = buildHeroPresence();
  root.add(hero);

  const applyPose = (pose: CharacterPoseState) => {
    // Cá
    ca.headPivot.rotation.y = pose.caHeadRotY;
    ca.headPivot.rotation.x = pose.caHeadRotX;
    ca.lidL.position.y = 0.008 + pose.caLidOffset;
    ca.lidR.position.y = 0.008 + pose.caLidOffset;

    // Cáo
    cao.headPivot.rotation.y = pose.caoHeadRotY;
    cao.headPivot.rotation.x = pose.caoHeadRotX;
    cao.browL.position.y = 0.295 + pose.caoBrowLift;
    cao.browR.position.y = 0.295 + pose.caoBrowLift;

    // Nóng
    nong.headPivot.rotation.y = pose.nongHeadRotY;
    nong.headPivot.rotation.x = pose.nongHeadRotX;
    nong.lidPivot.rotation.z = pose.nongLidTilt;
    nong.steamGroup.scale.setScalar(pose.nongSteamScale);
    nong.browL.rotation.z = Math.PI / 2 - pose.nongBrowTilt;
    nong.browR.rotation.z = Math.PI / 2 + pose.nongBrowTilt;
  };

  applyPose(PHASE_CHARACTER_POSES.arrival);

  return { root, applyPose };
}
