import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typedV3Configs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ['src/v3/**/*.ts'],
}));

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'lib/**',
      'node_modules/**',
      'src/parser/grammars/grammar.d.ts',
      'src/parser/grammars/grammar.js',
      'types/**',
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{cjs,js,mjs,ts}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
    },
  },
  ...typedV3Configs,
  {
    files: ['src/v3/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.v3.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
);
