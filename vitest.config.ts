import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        '.next/**',
        'tests/**',
        '**/*.config.*',
        '**/types/**',
      ],
      thresholds: {
        lines:     70,
        functions: 70,
        branches:  60,
        statements: 70,
      },
    },
    // Separate environments for unit vs integration
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules', '.next'],
    testTimeout: 10000,
    pool: 'forks',           // isolate each test file
    // Vitest 4 migration: poolOptions.forks.singleFork was removed in favor
    // of the top-level maxWorkers. Deliberately NOT setting isolate: false
    // (which the migration guide bundles with this) — that changes whether
    // module state resets between test FILES, not just workers, and several
    // test files in this suite rely on fresh module state per file (see the
    // repeated vi.resetModules() calls). Kept at its default (true) to
    // preserve the exact same per-file isolation this suite already depends on.
    maxWorkers: 1,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
