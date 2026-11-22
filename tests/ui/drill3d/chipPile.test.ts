import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHIP_RADIUS, layoutChipColumns } from '../../../src/ui/drill3d/scene/outs';

describe('chip pile resources and layout', () => {
  it.each([1, 2, 5, 7, 12])('centres %i non-intersecting columns', (count) => {
    const offsets = layoutChipColumns(count);
    expect(offsets).toHaveLength(count);
    expect(offsets.reduce((sum, p) => sum + p.x, 0) / count).toBeCloseTo(0);
    expect(offsets.reduce((sum, p) => sum + p.z, 0) / count).toBeCloseTo(0);
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        expect(Math.hypot(offsets[i]!.x - offsets[j]!.x, offsets[i]!.z - offsets[j]!.z))
          .toBeGreaterThanOrEqual(2 * CHIP_RADIUS);
      }
    }
  });

  it('disposes instance buffers during traversal', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const { disposeObject3DResources } = await import('../../../src/ui/drill3d/scene/palette');
      const dispose = vi.fn();
      const mesh = { isInstancedMesh: true, dispose };
      const root = { traverse: (visit: (obj: unknown) => void) => visit(mesh) };
      disposeObject3DResources(root as never);
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      random.mockRestore();
    }
  });
});

vi.mock('../../../src/ui/drill3d/scene/textures', async () => {
  const three = await import('three');
  return {
    createChipEdgeTexture: () => new three.Texture(),
    createChipTopTexture: (_body: string, _stripe: string, _accent: string, label: string) => {
      const texture = new three.Texture();
      texture.name = label;
      return texture;
    },
  };
});

afterEach(() => vi.restoreAllMocks());

it('creates one real instanced mesh per non-empty denomination', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const THREE = await import('three');
  const { createChipPile } = await import('../../../src/ui/drill3d/scene/buildTabletop');
  const pile = createChipPile({ 5: 3, 10: 0, 50: 12, 100: 1 });
  expect(pile.children).toHaveLength(3);
  const counts = Object.fromEntries(pile.children.map(child => {
    expect(child).toBeInstanceOf(THREE.InstancedMesh);
    const mesh = child as import('three').InstancedMesh;
    const material = (mesh.material as import('three').MeshStandardMaterial[])[1]!;
    return [material.map!.name, mesh.count];
  }));
  expect(counts).toEqual({ 5: 3, 50: 12, 100: 1 });
});
