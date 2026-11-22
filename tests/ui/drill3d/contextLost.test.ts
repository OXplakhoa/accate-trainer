import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_SPOT } from '../../../src/ui/drill3d/contract';
import {
  createManagedSceneController,
  disposeManagedController,
  type ManagedSceneController,
  type SceneControllerState,
} from '../../../src/ui/drill3d/scene/sceneController';

interface StubCanvas {
  className: string;
  parentNode: StubContainer | null;
  parentElement: StubContainer | null;
  attributes: Record<string, string>;
  listeners: Map<string, Set<(event: Event) => void>>;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  dispatch(type: string): { defaultPrevented: boolean };
}

interface StubContainer {
  children: StubCanvas[];
  appendChild(child: StubCanvas): StubCanvas;
  removeChild(child: StubCanvas): StubCanvas;
  getBoundingClientRect(): { width: number; height: number };
}

const { createStubCanvas, rendererSpies, tabletopSpies } = vi.hoisted(() => {
  function makeStubCanvas(): StubCanvas {
    const listeners = new Map<string, Set<(event: Event) => void>>();
    return {
      className: '',
      parentNode: null,
      parentElement: null,
      attributes: {},
      listeners,
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      addEventListener(type, listener) {
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      dispatch(type) {
        let defaultPrevented = false;
        const event = {
          type,
          preventDefault() {
            defaultPrevented = true;
          },
        } as unknown as Event;
        for (const listener of [...(listeners.get(type) ?? [])]) {
          listener(event);
        }
        return { defaultPrevented };
      },
    };
  }

  return {
    createStubCanvas: makeStubCanvas,
    rendererSpies: {
      lastCanvas: null as StubCanvas | null,
      dispose: vi.fn(),
      render: vi.fn(),
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
    },
    tabletopSpies: {
      active: false,
      updateSpot: vi.fn(),
      updateHighlight: vi.fn(),
      playAnimations: vi.fn(),
      stepAnimations: vi.fn(),
      snapAnimations: vi.fn(),
    },
  };
});

function createStubContainer(): StubContainer {
  const container: StubContainer = {
    children: [],
    appendChild(child) {
      child.parentNode = container;
      child.parentElement = container;
      container.children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = container.children.indexOf(child);
      if (idx !== -1) {
        container.children.splice(idx, 1);
      }
      child.parentNode = null;
      child.parentElement = null;
      return child;
    },
    getBoundingClientRect() {
      return { width: 640, height: 480 };
    },
  };
  return container;
}

vi.mock('three', () => {
  class MockVector3 {
    public x = 0;
    public y = 0;
    public z = 0;
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    public set(x: number, y: number, z: number): this {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
    public copy(v: MockVector3): this {
      return this.set(v.x, v.y, v.z);
    }
    public clone(): MockVector3 {
      return new MockVector3(this.x, this.y, this.z);
    }
    public lerpVectors(a: MockVector3, b: MockVector3, t: number): this {
      this.x = a.x + (b.x - a.x) * t;
      this.y = a.y + (b.y - a.y) * t;
      this.z = a.z + (b.z - a.z) * t;
      return this;
    }
  }

  class MockObject3D {
    public readonly children: MockObject3D[] = [];
    public readonly position = new MockVector3();
    public add(obj: MockObject3D): this {
      this.children.push(obj);
      return this;
    }
    public traverse(cb: (obj: MockObject3D) => void): void {
      cb(this);
      for (const child of this.children) {
        child.traverse(cb);
      }
    }
  }

  class MockScene extends MockObject3D {
    public background: unknown = null;
    public fog: unknown = null;
  }

  class MockPerspectiveCamera extends MockObject3D {
    public fov: number;
    public aspect: number;
    constructor(fov = 50, aspect = 1) {
      super();
      this.fov = fov;
      this.aspect = aspect;
    }
    public lookAt(): void {}
    public updateProjectionMatrix(): void {}
  }

  class MockLight extends MockObject3D {
    public castShadow = false;
    public shadow = {
      mapSize: { set: vi.fn() },
      camera: { near: 0, far: 0, left: 0, right: 0, top: 0, bottom: 0 },
      bias: 0,
      normalBias: 0,
    };
  }

  class MockWebGLRenderer {
    public readonly domElement: StubCanvas;
    public readonly shadowMap = { enabled: false, type: 0 };
    public outputColorSpace = '';
    public toneMapping = 0;
    public toneMappingExposure = 1;

    constructor() {
      this.domElement = createStubCanvas();
      rendererSpies.lastCanvas = this.domElement;
    }

    public setPixelRatio(ratio: number): void {
      rendererSpies.setPixelRatio(ratio);
    }

    public setSize(w: number, h: number, updateStyle?: boolean): void {
      rendererSpies.setSize(w, h, updateStyle);
    }

    public render(scene: unknown, camera: unknown): void {
      rendererSpies.render(scene, camera);
    }

    public dispose(): void {
      rendererSpies.dispose();
    }
  }

  return {
    Vector3: MockVector3,
    Object3D: MockObject3D,
    Group: MockObject3D,
    Scene: MockScene,
    PerspectiveCamera: MockPerspectiveCamera,
    Color: class MockColor {},
    Fog: class MockFog {},
    HemisphereLight: MockLight,
    DirectionalLight: MockLight,
    PointLight: MockLight,
    WebGLRenderer: MockWebGLRenderer,
    PCFSoftShadowMap: 2,
    SRGBColorSpace: 'srgb',
    ACESFilmicToneMapping: 4,
    MathUtils: {
      degToRad: (deg: number) => (deg * Math.PI) / 180,
      radToDeg: (rad: number) => (rad * 180) / Math.PI,
    },
  };
});

vi.mock('../../../src/ui/drill3d/scene/palette', () => ({
  SCENE_COLORS: { roomWall: 0xf3e8d4 },
  disposeObject3DResources: vi.fn(),
}));

vi.mock('../../../src/ui/drill3d/scene/buildRoomAndTable', () => ({
  buildRoomAndTable: () => ({ traverse: vi.fn() }),
}));

vi.mock('../../../src/ui/drill3d/scene/buildCharacters', () => ({
  PHASE_CHARACTER_POSES: {
    arrival: { caLean: 0, caoLean: 0, nongLean: 0 },
    decision: { caLean: 0, caoLean: 0, nongLean: 0 },
    review: { caLean: 0, caoLean: 0, nongLean: 0 },
  },
  getLiveCharacterPose: () => ({ caLean: 0, caoLean: 0, nongLean: 0 }),
  lerpCharacterPose: (_a: unknown, b: unknown) => b,
  buildCharacters: () => ({
    root: { traverse: vi.fn() },
    applyPose: vi.fn(),
    setOccupiedRivals: vi.fn(),
  }),
}));

vi.mock('../../../src/ui/drill3d/scene/buildTabletop', () => ({
  buildTabletop: () => ({
    root: { traverse: vi.fn() },
    updateSpot: (spot: unknown) => tabletopSpies.updateSpot(spot),
    updateHighlight: (h: unknown) => tabletopSpies.updateHighlight(h),
    playAnimations: (anims: unknown, now: number) => {
      tabletopSpies.active = true;
      tabletopSpies.playAnimations(anims, now);
    },
    stepAnimations: (now: number) => {
      const keepGoing = tabletopSpies.stepAnimations(now) ?? false;
      tabletopSpies.active = keepGoing;
      return keepGoing;
    },
    snapAnimations: () => {
      tabletopSpies.active = false;
      tabletopSpies.snapAnimations();
    },
    hasActiveAnimations: () => tabletopSpies.active,
  }),
}));

const INITIAL_STATE: SceneControllerState = {
  phase: 'decision',
  highlight: null,
  spot: DEMO_SPOT,
  reducedMotion: false,
};

describe('DrillScene WebGL context loss disposal lifecycle', () => {
  beforeEach(() => {
    rendererSpies.lastCanvas = null;
    rendererSpies.dispose.mockReset();
    rendererSpies.render.mockReset();
    rendererSpies.setSize.mockReset();
    rendererSpies.setPixelRatio.mockReset();
    tabletopSpies.active = false;
    tabletopSpies.updateSpot.mockReset();
    tabletopSpies.updateHighlight.mockReset();
    tabletopSpies.playAnimations.mockReset();
    tabletopSpies.stepAnimations.mockReset();
    tabletopSpies.snapAnimations.mockReset();
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('disposes the controller exactly once and removes the canvas on runtime webglcontextlost', () => {
    const container = createStubContainer();
    const controllerRef: { current: ManagedSceneController | null } = { current: null };
    const onWebglFailed = vi.fn();

    createManagedSceneController({
      container: container as unknown as HTMLElement,
      controllerRef,
      initialState: INITIAL_STATE,
      isCancelled: () => false,
      onWebglFailed,
    });

    const controller = controllerRef.current;
    const canvas = rendererSpies.lastCanvas;
    expect(controller).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(container.children).toEqual([canvas]);
    expect(canvas!.className).toBe('drill3d-canvas');

    const controllerDisposeSpy = vi.spyOn(controller!, 'dispose');

    // Simulate runtime WebGL context loss (e.g. mobile app switch)
    const eventResult = canvas!.dispatch('webglcontextlost');

    expect(eventResult.defaultPrevented).toBe(true);
    expect(onWebglFailed).toHaveBeenCalledTimes(1);
    expect(controllerDisposeSpy).toHaveBeenCalledTimes(1);
    expect(rendererSpies.dispose).toHaveBeenCalledTimes(1);
    expect(controllerRef.current).toBeNull();
    expect(container.children).toHaveLength(0);
    expect(canvas!.listeners.get('webglcontextlost')?.size ?? 0).toBe(0);

    // Unmount cleanup after context loss must NOT dispose a second time
    expect(disposeManagedController(controllerRef)).toBe(false);
    expect(controllerDisposeSpy).toHaveBeenCalledTimes(1);
    expect(rendererSpies.dispose).toHaveBeenCalledTimes(1);

    // Direct repeated dispose() on the controller itself is also idempotent
    controller!.dispose();
    expect(rendererSpies.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes once and clears ref if context loss fires synchronously during mount', () => {
    const container = createStubContainer();
    const controllerRef: { current: ManagedSceneController | null } = { current: null };
    const onWebglFailed = vi.fn();
    const canvas = createStubCanvas();
    const dispose = vi.fn(() => {
      if (canvas.parentNode === container) {
        container.removeChild(canvas);
      }
    });

    createManagedSceneController({
      container: container as unknown as HTMLElement,
      controllerRef,
      initialState: INITIAL_STATE,
      isCancelled: () => false,
      onWebglFailed,
      createController: (el, _state, onContextLost) => {
        (el as unknown as StubContainer).appendChild(canvas);
        onContextLost();
        return { update: vi.fn(), dispose };
      },
    });

    expect(onWebglFailed).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(controllerRef.current).toBeNull();
    expect(container.children).toHaveLength(0);

    // Unmount cleanup is a no-op
    expect(disposeManagedController(controllerRef)).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('skips creation if already cancelled before resolution and disposes cleanly on normal unmount', () => {
    const container = createStubContainer();
    const controllerRef: { current: ManagedSceneController | null } = { current: null };
    const onWebglFailed = vi.fn();
    const factory = vi.fn();

    createManagedSceneController({
      container: container as unknown as HTMLElement,
      controllerRef,
      initialState: INITIAL_STATE,
      isCancelled: () => true,
      onWebglFailed,
      createController: factory,
    });
    expect(factory).not.toHaveBeenCalled();
    expect(controllerRef.current).toBeNull();

    createManagedSceneController({
      container: container as unknown as HTMLElement,
      controllerRef,
      initialState: INITIAL_STATE,
      isCancelled: () => false,
      onWebglFailed,
    });
    expect(container.children).toHaveLength(1);
    expect(controllerRef.current).not.toBeNull();

    expect(disposeManagedController(controllerRef)).toBe(true);
    expect(controllerRef.current).toBeNull();
    expect(container.children).toHaveLength(0);
    expect(rendererSpies.dispose).toHaveBeenCalledTimes(1);

    expect(disposeManagedController(controllerRef)).toBe(false);
    expect(rendererSpies.dispose).toHaveBeenCalledTimes(1);
  });

  it('plays initial deal once on mount, enforces monotonic progress (3 -> 4 -> 3 -> 4), and snaps mid-flight on reducedMotion', async () => {
    vi.spyOn(globalThis.performance, 'now').mockReturnValue(100);
    const { DrillSceneController } = await import('../../../src/ui/drill3d/scene/sceneController');
    const rafQueue: ((now: number) => void)[] = [];
    let nextRafId = 1;
    const cancelRaf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      rafQueue.push(cb);
      return nextRafId++;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelRaf);

    const makeLiveState = (
      timelineLength: number,
      street: 'preflop' | 'flop',
      board: readonly string[],
      caoBet: number,
      reducedMotion = false,
    ): SceneControllerState => ({
      phase: 'decision',
      highlight: null,
      reducedMotion,
      spot: {
        pot: 20 + caoBet,
        call: caoBet,
        heroCards: ['A♥', 'K♦'],
        board,
        live: {
          potChips: { 5: 4 + (caoBet > 0 ? 1 : 0), 10: caoBet > 0 ? 3 : 0, 50: 0, 100: 0 },
          handNumber: 1,
          timelineLength,
          dealerSeatId: 'hero',
          street,
          occupiedRivals: ['ca', 'cao', 'nong'],
          activeRival: 'cao',
          activePlayerName: 'Cáo',
          payoutTransfers: [],
          seats: [
            { id: 'hero', stackChips: { 5: 20, 10: 20, 50: 4, 100: 0 }, streetChips: { 5: 0, 10: 0, 50: 0, 100: 0 }, status: 'active', lastAction: null, isActor: false, isWinner: false, revealedCards: ['A♥', 'K♦'] },
            { id: 'ca', stackChips: { 5: 20, 10: 20, 50: 4, 100: 0 }, streetChips: { 5: 0, 10: 0, 50: 0, 100: 0 }, status: 'active', lastAction: null, isActor: false, isWinner: false, revealedCards: null },
            { id: 'cao', stackChips: { 5: 20 - (caoBet > 0 ? 1 : 0), 10: 20 - (caoBet > 0 ? 3 : 0), 50: 4, 100: 0 }, streetChips: { 5: caoBet > 0 ? 1 : 0, 10: caoBet > 0 ? 3 : 0, 50: 0, 100: 0 }, status: 'active', lastAction: caoBet > 0 ? { type: 'bet', amount: caoBet } : null, isActor: caoBet === 0, isWinner: false, revealedCards: null },
            { id: 'nong', stackChips: { 5: 20, 10: 20, 50: 4, 100: 0 }, streetChips: { 5: 0, 10: 0, 50: 0, 100: 0 }, status: 'active', lastAction: null, isActor: false, isWinner: false, revealedCards: null },
          ],
        },
      },
    });

    const container = createStubContainer();
    // Initial preflop empty-board live snapshot plays deal once on mount
    const snap3 = makeLiveState(3, 'preflop', [], 0);
    const controller = new DrillSceneController(
      container as unknown as HTMLElement,
      snap3,
      vi.fn(),
    );
    expect(tabletopSpies.playAnimations).toHaveBeenCalledTimes(1);
    expect(rafQueue).toHaveLength(1);

    // Complete initial deal rAF tick -> loop stops cleanly
    tabletopSpies.stepAnimations.mockReturnValueOnce(false);
    rafQueue.shift()!(1000);
    expect(rafQueue).toHaveLength(0);

    // 3 -> 4: Cáo bets 35 -> plays once
    const snap4 = makeLiveState(4, 'preflop', [], 35);
    tabletopSpies.stepAnimations.mockReturnValue(true);
    controller.update(snap4);
    expect(tabletopSpies.playAnimations).toHaveBeenCalledTimes(2);
    expect(rafQueue).toHaveLength(1);

    // 4 -> 3 (stale): snaps without playing animations and does NOT lower high-water
    controller.update(snap3);
    expect(tabletopSpies.playAnimations).toHaveBeenCalledTimes(2);
    expect(tabletopSpies.snapAnimations).toHaveBeenCalled();

    // 3 -> 4 again: must NOT replay Cáo's Bet 35
    controller.update(snap4);
    expect(tabletopSpies.playAnimations).toHaveBeenCalledTimes(2);

    // Turning reducedMotion on mid-flight cancels rAF and snaps immediately
    const snap5 = makeLiveState(5, 'preflop', [], 35);
    tabletopSpies.playAnimations.mockClear();
    tabletopSpies.snapAnimations.mockClear();
    // Advance with a fold or call on another seat via snap4 -> reducedMotion toggle during an active animation
    tabletopSpies.active = true;
    controller.update({ ...snap5, reducedMotion: true });
    expect(tabletopSpies.snapAnimations).toHaveBeenCalled();
    expect(cancelRaf).toHaveBeenCalled();

    controller.dispose();
  });
});
