import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENGINE_DIR = fileURLToPath(new URL('../../src/engine', import.meta.url));

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function isRegularTsFile(filePath: string): boolean {
  return filePath.endsWith('.ts') && !filePath.endsWith('.d.ts');
}

describe('engine boundary', () => {
  it('contains only regular .ts files (no .js/.mjs/.cjs/.mts/.cts/.tsx/.jsx/.d.ts)', () => {
    const allFiles = collectFiles(ENGINE_DIR);
    expect(allFiles.length).toBeGreaterThan(0);

    const invalidFiles = allFiles
      .filter((filePath) => !isRegularTsFile(filePath))
      .map((filePath) => relative(ENGINE_DIR, filePath));

    expect(invalidFiles).toEqual([]);
  });

  it('blocks non-deterministic runtime APIs in engine tests', () => {
    expect(() => Math.random()).toThrow();
    expect(() => Date.now()).toThrow();
    expect(() => performance.now()).toThrow();
    expect(() => crypto.getRandomValues(new Uint32Array(1))).toThrow();
    expect(() => crypto.randomUUID()).toThrow();
  });
});
