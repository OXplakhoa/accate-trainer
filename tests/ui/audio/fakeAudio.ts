import { type Mock, vi } from 'vitest';

const parameter = () => ({
  value: 0,
  setValueAtTime: vi.fn<(value: number, at: number) => void>(),
  linearRampToValueAtTime: vi.fn<(value: number, at: number) => void>(),
  exponentialRampToValueAtTime: vi.fn<(value: number, at: number) => void>(),
});

interface RecordedNode {
  connect: Mock<(destination: RecordedNode) => void>;
  disconnect: Mock<() => void>;
}

function audioNode(): RecordedNode {
  return {
    connect: vi.fn<(destination: RecordedNode) => void>(),
    disconnect: vi.fn(),
  };
}

function scheduledSource() {
  return {
    ...audioNode(),
    start: vi.fn<(...times: number[]) => void>(),
    stop: vi.fn<(...times: number[]) => void>(),
    onended: null as (() => void) | null,
    frequency: parameter(),
    buffer: null as object | null,
    type: '',
    loop: false,
  };
}

export function audioEnvironment(options: { state?: string; stereo?: boolean } = {}) {
  const nodes: ReturnType<typeof audioNode>[] = [];
  const gains: Array<ReturnType<typeof audioNode> & { gain: ReturnType<typeof parameter> }> = [];
  const filters: Array<ReturnType<typeof makeFilter>> = [];
  const panners: Array<ReturnType<typeof audioNode> & { pan: ReturnType<typeof parameter> }> = [];
  const voices: ReturnType<typeof scheduledSource>[] = [];
  const oscillators: typeof voices = [];
  const bufferSources: typeof voices = [];
  type Listener = (event: { currentTarget: object }) => void;
  type ListenerRegistration = (name: string, listener: Listener, capture?: boolean) => void;
  const listeners = new Map<string, Set<Listener>>();
  const doc = {
    hidden: false,
    addEventListener: vi.fn<ListenerRegistration>((name, listener) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    }),
    removeEventListener: vi.fn<ListenerRegistration>((name, listener) => {
      listeners.get(name)?.delete(listener);
    }),
  };

  function makeFilter() {
    return { ...audioNode(), type: '', frequency: parameter(), Q: parameter() };
  }

  function record<T extends ReturnType<typeof audioNode>>(node: T, collection?: T[]): T {
    nodes.push(node);
    collection?.push(node);
    return node;
  }

  function recordSource(collection: typeof voices) {
    const voice = record(scheduledSource(), collection);
    voices.push(voice);
    return voice;
  }

  const makeContext = () => ({
    state: options.state ?? 'running',
    currentTime: 0,
    sampleRate: 8000,
    destination: audioNode(),
    onstatechange: null as (() => void) | null,
    createGain: () => record({ ...audioNode(), gain: parameter() }, gains),
    createOscillator: () => recordSource(oscillators),
    createBufferSource: () => recordSource(bufferSources),
    createBiquadFilter: () => record(makeFilter(), filters),
    createStereoPanner:
      options.stereo === false
        ? undefined
        : () => record({ ...audioNode(), pan: parameter() }, panners),
    createDynamicsCompressor: vi.fn(() =>
      record({
        ...audioNode(),
        attack: parameter(),
        release: parameter(),
        threshold: parameter(),
        knee: parameter(),
        ratio: parameter(),
      }),
    ),
    createBuffer: vi.fn((_channels: number, length: number) => {
      const samples = new Float32Array(length);
      return { getChannelData: () => samples };
    }),
    resume: vi.fn<() => Promise<void>>(),
    suspend: vi.fn<() => Promise<void>>(),
    close: vi.fn<() => Promise<void>>(),
  });
  function createContext() {
    const context = makeContext();
    context.resume.mockImplementation(async () => {
      context.state = 'running';
      context.onstatechange?.();
    });
    context.suspend.mockImplementation(async () => {
      context.state = 'suspended';
      context.onstatechange?.();
    });
    context.close.mockImplementation(async () => {
      context.state = 'closed';
    });
    return context;
  }
  const contexts = [createContext()];
  const AudioContextMock = vi.fn(function () {
    const context = contexts[thisCall++];
    if (context) return context;
    const next = createContext();
    contexts.push(next);
    return next;
  });
  let thisCall = 0;

  class FakeElement {
    readonly ownerDocument = doc;

    constructor(private readonly inDrill: boolean) {}

    closest(selector: string) {
      return selector === '.drill-shell' && this.inDrill ? this : null;
    }
  }

  function dispatch(name: string, detail: object) {
    for (const listener of listeners.get(name) ?? []) {
      listener({ currentTarget: doc, ...detail });
    }
  }

  vi.stubGlobal('window', { AudioContext: AudioContextMock });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('KeyboardEvent', class {});
  return {
    context: contexts[0]!,
    contexts,
    voices,
    oscillators,
    bufferSources,
    nodes,
    gains,
    filters,
    panners,
    doc,
    listeners,
    AudioContextMock,
    liveVoices: () => voices.filter(({ onended }) => onended !== null),
    advanceTo: (time: number) => {
      const context = contexts.at(-1)!;
      context.currentTime = time;
      for (const voice of voices) {
        if ((voice.stop.mock.calls[0]?.[0] ?? Infinity) <= time) voice.onended?.();
      }
    },
    setHidden: (hidden: boolean) => {
      doc.hidden = hidden;
      dispatch('visibilitychange', {});
    },
    drillShell: () => new FakeElement(true) as unknown as Element,
    click: (target: boolean | Element, isTrusted = true) => {
      dispatch('click', {
        target: typeof target === 'boolean' ? new FakeElement(target) : target,
        isTrusted,
      });
    },
  };
}

export function mockBrowserTimer(kind: 'interval' | 'timeout') {
  const callbacks = new Map<number, () => void>();
  let nextId = 0;
  const setTimer = vi
    .spyOn(globalThis, kind === 'interval' ? 'setInterval' : 'setTimeout')
    .mockImplementation((...[handler]) => {
      if (typeof handler !== 'function') throw new TypeError('Expected a timer callback');
      const id = ++nextId;
      callbacks.set(id, () => {
        handler();
      });
      return id;
    });
  vi.spyOn(globalThis, kind === 'interval' ? 'clearInterval' : 'clearTimeout').mockImplementation(
    (id) => {
      callbacks.delete(Number(id));
    },
  );
  return {
    setTimer,
    count: () => callbacks.size,
    fire: () => {
      for (const [id, callback] of [...callbacks]) {
        if (kind === 'timeout') callbacks.delete(id);
        callback();
      }
    },
  };
}
