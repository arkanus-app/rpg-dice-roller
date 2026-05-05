module.exports = {
  collectCoverageFrom: [
    '<rootDir>/src/**/*.js',
    '<rootDir>/src/**/*.ts',
  ],
  coveragePathIgnorePatterns: [
    '<rootDir>/src/parser/grammars/(generate|grammar).js',
  ],
  moduleNameMapper: {
    '^\\./results/(.*)\\.js$': '<rootDir>/src/results/$1.ts',
    '^\\.\\./results/(.*)\\.js$': '<rootDir>/src/results/$1.ts',
    '^\\./ResultGroup\\.js$': '<rootDir>/src/results/ResultGroup.ts',
    '^\\./RollResult\\.js$': '<rootDir>/src/results/RollResult.ts',
    '^\\./RollResults\\.js$': '<rootDir>/src/results/RollResults.ts',
    '^\\.\\./\\.\\./src/results/(.*)\\.js$': '<rootDir>/src/results/$1.ts',
    '^\\.\\./src/results/(.*)\\.js$': '<rootDir>/src/results/$1.ts',
  },
  testMatch: [
    '<rootDir>/tests/**/*.[jt]s?(x)',
  ],
};
