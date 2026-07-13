import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        'src/parser/grammars/grammar.js',
        'src/**/*.test.ts',
      ],
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 95,
        statements: 95,
      },
    },
    environment: 'node',
    exclude: ['tests/browser/**'],
    include: [
      'src/v3/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    mockReset: false,
    restoreMocks: false,
  },
});
