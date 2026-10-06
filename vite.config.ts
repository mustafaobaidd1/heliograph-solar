import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/** GitHub Pages serves this project from https://mustafaobaidd1.github.io/heliograph-solar/ */
export const REPO = 'heliograph-solar';

export default defineConfig({
  // Same base path in dev, preview and production, so path bugs show up locally.
  base: `/${REPO}/`,
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  server: { port: 5303, strictPort: true },
  preview: { port: 5403, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
