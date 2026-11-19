const forbidden = (api: string) => () => {
  throw new Error(`Non-deterministic API "${api}" is forbidden in engine tests.`);
};

Object.defineProperty(Math, 'random', {
  configurable: true,
  writable: true,
  value: forbidden('Math.random'),
});

Object.defineProperty(Date, 'now', {
  configurable: true,
  writable: true,
  value: forbidden('Date.now'),
});

Object.defineProperty(globalThis.performance, 'now', {
  configurable: true,
  writable: true,
  value: forbidden('performance.now'),
});

const originalCrypto = globalThis.crypto;
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  enumerable: true,
  value: new Proxy(originalCrypto, {
    get(target, prop) {
      if (prop === 'getRandomValues') {
        return forbidden('crypto.getRandomValues');
      }
      if (prop === 'randomUUID') {
        return forbidden('crypto.randomUUID');
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }),
});
