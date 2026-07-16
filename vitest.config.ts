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
      // Server-side libs at project root — explicit maps for vitest
      '@/lib/caseSearch': path.resolve(__dirname, './lib/caseSearch.ts'),
      '@/lib/dateRange': path.resolve(__dirname, './lib/dateRange.ts'),
      '@/lib/caseFilters': path.resolve(__dirname, './lib/caseFilters.ts'),
      '@/lib/combinedFilter': path.resolve(__dirname, './lib/combinedFilter.ts'),
      '@/lib/caseParties': path.resolve(__dirname, './lib/caseParties.ts'),
      '@/lib/bodyParts': path.resolve(__dirname, './lib/bodyParts.ts'),
      '@/lib/roleSlots': path.resolve(__dirname, './lib/roleSlots.ts'),
      '@/lib/tools': path.resolve(__dirname, './lib/tools'),
      '@/lib/domains': path.resolve(__dirname, './lib/domains'),
      '@': path.resolve(__dirname, '.'),
    },
  },
});
