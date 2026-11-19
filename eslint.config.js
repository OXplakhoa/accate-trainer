import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
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
    files: ['src/engine/**/*.ts', 'src/engine/**/*.tsx'],
    languageOptions: {
      globals: globals.es2022,
    },
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'src/engine must remain pure TypeScript and cannot access window.',
        },
        {
          name: 'document',
          message: 'src/engine must remain pure TypeScript and cannot access document.',
        },
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
          message: 'src/engine must remain pure TypeScript and cannot access window.',
        },
        {
          object: 'globalThis',
          property: 'document',
          message: 'src/engine must remain pure TypeScript and cannot access document.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
              message: 'src/engine must remain pure TypeScript and cannot import React.',
            },
            {
              group: ['**/ui', '**/ui/*', '**/ui/**', '../ui', '../ui/*', '../ui/**'],
              message: 'src/engine cannot import from src/ui.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
