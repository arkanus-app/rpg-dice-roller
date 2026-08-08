import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['src/**/*.test.ts'],
      include: ['src/v3/**/*.ts'],
      provider: 'v8',
      reportsDirectory: 'coverage-v3',
      reporter: ['text-summary', 'json-summary'],
      thresholds: {
        perFile: true,
        branches: 80,
        functions: 95,
        lines: 88,
        statements: 88,
      },
    },
    environment: 'node',
    include: ['src/v3/**/*.test.ts'],
    mockReset: false,
    restoreMocks: false,
  },
});
