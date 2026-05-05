module.exports = {
  collectCoverageFrom: [
    '<rootDir>/src/**/*.js',
    '<rootDir>/src/**/*.ts',
  ],
  coveragePathIgnorePatterns: [
    '<rootDir>/src/parser/grammars/(generate|grammar).js',
  ],
  testMatch: [
    '<rootDir>/tests/**/*.[jt]s?(x)',
  ],
};
