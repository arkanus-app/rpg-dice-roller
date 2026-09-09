import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        'src/**/*.test.ts',
      ],
      include: ['src/v3/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      thresholds: {
        perFile: true,
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    environment: 'node',
    exclude: ['tests/browser/**'],
    include: [
      'src/v3/**/*.test.ts',
    ],
    mockReset: false,
    restoreMocks: false,
  },
});
