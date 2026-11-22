import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/sandbox-3d',
    rollupOptions: { input: ['sandbox-3d.html', 'prototype-3d.html'] },
  },
});
