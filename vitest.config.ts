import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      // This shared server lib lives at the project root, not under src. Map the
      // exact module so other '@/lib/*' imports still resolve via the '@'→src
      // alias below.
      '@/lib/caseSearch': path.resolve(__dirname, './lib/caseSearch.ts'),
      '@/lib/dateRange': path.resolve(__dirname, './lib/dateRange.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
