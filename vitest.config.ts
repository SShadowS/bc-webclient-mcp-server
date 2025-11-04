/**
 * Vitest Configuration
 *
 * Unit test configuration for BC MCP Server
 */

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // Coverage thresholds
      lines: 85,
      branches: 80,
      functions: 85,
      statements: 85,
      exclude: [
        'src/**/index.ts',
        'src/types/**',
        'src/**/*.d.ts',
        'src/**/*.spec.ts',
        'test-*.ts',
        'test-*.mjs',
        '*.config.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
