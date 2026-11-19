import { builtinModules } from 'node:module';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nodeBuiltins = builtinModules.filter((m) => !m.startsWith('_') && !m.startsWith('node:'));

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended],
    files: ['**/*.{js,mjs,cjs,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.es2022,
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.es2022,
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/main.tsx'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/engine/**/*'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.es2022,
    },
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/engine cannot access window.' },
        { name: 'document', message: 'src/engine cannot access document.' },
        { name: 'self', message: 'src/engine cannot access self.' },
        { name: 'globalThis', message: 'src/engine cannot access globalThis.' },
        { name: 'navigator', message: 'src/engine cannot access navigator.' },
        { name: 'localStorage', message: 'src/engine cannot access localStorage.' },
        { name: 'sessionStorage', message: 'src/engine cannot access sessionStorage.' },
        { name: 'indexedDB', message: 'src/engine cannot access indexedDB.' },
        { name: 'fetch', message: 'src/engine cannot perform network I/O (fetch).' },
        {
          name: 'XMLHttpRequest',
          message: 'src/engine cannot perform network I/O (XMLHttpRequest).',
        },
        { name: 'WebSocket', message: 'src/engine cannot perform network I/O (WebSocket).' },
        {
          name: 'performance',
          message: 'src/engine must be deterministic and cannot access performance.',
        },
        {
          name: 'crypto',
          message: 'src/engine must be deterministic and cannot access crypto; use Rng.',
        },
        { name: 'setTimeout', message: 'src/engine cannot use timers (setTimeout).' },
        { name: 'setInterval', message: 'src/engine cannot use timers (setInterval).' },
        { name: 'clearTimeout', message: 'src/engine cannot use timers (clearTimeout).' },
        { name: 'clearInterval', message: 'src/engine cannot use timers (clearInterval).' },
        {
          name: 'requestAnimationFrame',
          message: 'src/engine cannot use requestAnimationFrame.',
        },
        { name: 'queueMicrotask', message: 'src/engine cannot use queueMicrotask.' },
        { name: 'process', message: 'src/engine cannot access Node process.' },
        { name: 'Date', message: 'src/engine must be deterministic and cannot use Date.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Do not use Math.random in src/engine; use Rng from src/engine/rng instead.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Do not use Date.now in src/engine; engine logic must be deterministic.',
        },
        {
          object: 'globalThis',
          property: 'window',
          message: 'src/engine cannot access globalThis.window.',
        },
        {
          object: 'globalThis',
          property: 'document',
          message: 'src/engine cannot access globalThis.document.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Dynamic import() is forbidden in src/engine.',
        },
        {
          selector: "VariableDeclarator[init.name='Math']",
          message:
            'Aliasing or destructuring Math is forbidden in src/engine; call Math.* directly.',
        },
        {
          selector: "AssignmentExpression[right.name='Math']",
          message: 'Assigning or destructuring Math is forbidden in src/engine.',
        },
        {
          selector: "AssignmentPattern[right.name='Math']",
          message: 'Aliasing Math via default parameter is forbidden in src/engine.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.value='random']",
          message: "Do not access Math['random'] in src/engine; use Rng.",
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: nodeBuiltins.map((name) => ({
            name,
            message: `src/engine cannot import Node built-in module "${name}".`,
          })),
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
              message: 'src/engine must remain pure TypeScript and cannot import React.',
            },
            {
              group: ['**/ui', '**/ui/**', '../ui', '../ui/**', '../../ui', '../../ui/**'],
              message: 'src/engine cannot import from src/ui.',
            },
            {
              group: ['**/main', '**/main.*', '../main', '../main.*', '../../main', '../../main.*'],
              message: 'src/engine cannot import from main.',
            },
            {
              group: ['node:*'],
              message: 'src/engine cannot import Node built-in modules.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
