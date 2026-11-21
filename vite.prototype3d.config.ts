import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/prototype-3d',
    rollupOptions: { input: 'prototype-3d.html' },
  },
});
