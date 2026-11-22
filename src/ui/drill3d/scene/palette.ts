import * as THREE from 'three';

export const SCENE_COLORS = {
  roomWall: 0xf3e8d4,
  roomWallShade: 0xdcc7aa,
  roomWainscot: 0xc8af8e,
  roomTrim: 0xb29673,
  roomFloor: 0xb88f64,
  roomFloorDark: 0x946d45,
  windowGlow: 0xfff6e3,
  pendantShade: 0xf4ead7,
  pendantBrass: 0xc29650,
  tableFelt: 0x34786d,
  tableFeltDeep: 0x265d53,
  tableRim: 0x533c31,
  tableRimWarm: 0x674b3d,
  tableTrimBrass: 0xc79e59,
  chairWood: 0x5a3f31,
  chairCushion: 0x7e5440,

  // Character signature hues from spec
  caBlue: 0x4f9dd3,
  caBlueDeep: 0x3276ab,
  caBelly: 0xa9d2eb,
  caHand: 0x82c8ee,
  caCheek: 0xd98a7c,
  caVest: 0x2f5069,
  caShirt: 0xf1e8d8,

  caoOrange: 0xe18a46,
  caoOrangeDeep: 0xc26e2f,
  caoPaw: 0xe89b5a,
  caoCream: 0xf7ecdb,
  caoEarInner: 0xf0c7a2,
  caoEarTip: 0x3a2a23,
  caoJacket: 0x495e4c,
  caoTie: 0x8f3d32,

  nongRed: 0xc95849,
  nongRedDeep: 0xa33f32,
  nongHand: 0xd96e5c,
  nongStripe: 0xeee1ca,
  nongBrass: 0xc19654,
  nongHandleWood: 0x4b3328,
  nongVest: 0x3f3938,
  nongSweater: 0xc79045,
  nongSteam: 0xfbf6ec,

  heroSleeve: 0x3d544f,
  heroCuff: 0xd8ccb8,
  heroSkin: 0xe0b692,

  // Home-game room props
  propCabinetWood: 0xb07d58,
  propCabinetDark: 0x8a5e42,
  propCeladon: 0x9ac4b0,
  propPlanter: 0xc46f50,
  propLeaf: 0x48805e,
  propLeafLight: 0x629c76,
  propRugField: 0xae9573,
  propRugBand: 0x8f4c3b,
  propRugGold: 0xb88746,

  ink: 0x261f1c,
  ivory: 0xfaf5eb,
  cardRed: 0xc73b3a,
  cardBlack: 0x24292e,

  // Highlight accents
  highlightPot: 0xf0be52,
  highlightCall: 0xe47452,
  highlightTotal: 0xf5cb62,
  highlightOuts: 0xe25c67,
} as const;

export const CSS_COLORS = {
  roomWall: '#F3E8D4',
  tableFelt: '#34786D',
  tableRim: '#533C31',
  caBlue: '#4F9DD3',
  caoOrange: '#E18A46',
  nongRed: '#C95849',
} as const;

export interface MatteMaterialOptions {
  readonly roughness?: number;
  readonly metalness?: number;
  readonly emissive?: number;
  readonly emissiveIntensity?: number;
  readonly map?: THREE.Texture;
  readonly transparent?: boolean;
  readonly opacity?: number;
  readonly side?: THREE.Side;
  readonly depthWrite?: boolean;
}

export function createMatteMaterial(
  color: number,
  options: MatteMaterialOptions = {},
): THREE.MeshStandardMaterial {
  const params: THREE.MeshStandardMaterialParameters = {
    color,
    roughness: options.roughness ?? 0.86,
    metalness: options.metalness ?? 0.03,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side ?? THREE.FrontSide,
    depthWrite: options.depthWrite ?? true,
  };
  if (options.emissive !== undefined) {
    params.emissive = new THREE.Color(options.emissive);
  }
  if (options.map !== undefined) {
    params.map = options.map;
  }
  return new THREE.MeshStandardMaterial(params);
}

export function disposeObject3DResources(
  root: THREE.Object3D,
  preserveTextures?: ReadonlySet<THREE.Texture>,
): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((obj) => {
    const light = obj as THREE.Light;
    if (light.isLight && typeof light.dispose === 'function') {
      light.dispose();
    }
    const instanced = obj as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      instanced.dispose();
    }
    const mesh = obj as THREE.Mesh;
    const sprite = obj as THREE.Sprite;
    if (!sprite.isSprite && mesh.geometry && typeof mesh.geometry.dispose === 'function') {
      geometries.add(mesh.geometry);
    }
    const matOrList = mesh.material;
    if (Array.isArray(matOrList)) {
      for (const mat of matOrList) {
        if (mat) {
          materials.add(mat);
        }
      }
    } else if (matOrList) {
      materials.add(matOrList);
    }
  });

  for (const mat of materials) {
    const std = mat as THREE.MeshStandardMaterial;
    const maps = [
      std.map,
      std.alphaMap,
      std.aoMap,
      std.bumpMap,
      std.emissiveMap,
      std.normalMap,
      std.roughnessMap,
    ];
    for (const tex of maps) {
      if (tex && !preserveTextures?.has(tex)) {
        textures.add(tex);
      }
    }
    mat.dispose();
  }

  for (const tex of textures) {
    tex.dispose();
  }

  for (const geo of geometries) {
    geo.dispose();
  }
}
