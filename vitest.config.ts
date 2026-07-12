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
      // Server-side libs live at the project ROOT (only), not under src. Map each
      // explicitly so they resolve here instead of falling through to the '@'→src
      // alias below (which is where the FRONTEND '@/lib/utils' etc. correctly
      // live — note '@/lib/utils' exists in BOTH, so we must NOT blanket-map @/lib).
      '@/lib/caseSearch': path.resolve(__dirname, './lib/caseSearch.ts'),
      '@/lib/dateRange': path.resolve(__dirname, './lib/dateRange.ts'),
      '@/lib/caseFilters': path.resolve(__dirname, './lib/caseFilters.ts'),
      '@/lib/combinedFilter': path.resolve(__dirname, './lib/combinedFilter.ts'),
      '@/lib/caseParties': path.resolve(__dirname, './lib/caseParties.ts'),
      '@/lib/bodyParts': path.resolve(__dirname, './lib/bodyParts.ts'),
      '@/lib/roleSlots': path.resolve(__dirname, './lib/roleSlots.ts'),
      // Whole root-only subtrees.
      '@/lib/tools': path.resolve(__dirname, './lib/tools'),
      '@/lib/domains': path.resolve(__dirname, './lib/domains'),
      '@': path.resolve(__dirname, './src'),
    },
  },
});
