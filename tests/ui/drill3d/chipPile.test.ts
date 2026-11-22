import { describe, expect, it, vi } from 'vitest';
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
