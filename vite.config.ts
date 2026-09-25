/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  server: { port: 5173, strictPort: false },
  test: {
    include: ['src/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
