import { readFileSync } from 'node:fs';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import type { RollupOptions } from 'rollup';

interface PackageMetadata {
  readonly author: string;
  readonly description: string;
  readonly homepage: string;
  readonly license: string;
  readonly name: string;
  readonly version: string;
}

const packageJsonValue = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as unknown;

if (
  typeof packageJsonValue !== 'object'
  || packageJsonValue === null
  || !('author' in packageJsonValue)
  || typeof packageJsonValue.author !== 'string'
  || !('description' in packageJsonValue)
  || typeof packageJsonValue.description !== 'string'
  || !('homepage' in packageJsonValue)
  || typeof packageJsonValue.homepage !== 'string'
  || !('license' in packageJsonValue)
  || typeof packageJsonValue.license !== 'string'
  || !('name' in packageJsonValue)
  || typeof packageJsonValue.name !== 'string'
  || !('version' in packageJsonValue)
  || typeof packageJsonValue.version !== 'string'
) {
  throw new TypeError('package.json has invalid package metadata');
}

const packageJson = {
  author: packageJsonValue.author,
  description: packageJsonValue.description,
  homepage: packageJsonValue.homepage,
  license: packageJsonValue.license,
  name: packageJsonValue.name,
  version: packageJsonValue.version,
} satisfies PackageMetadata;
const inputPath = 'src/index.ts';
const banner = `/*!
 * ${packageJson.name} - ${packageJson.description}
 *
 * @version ${packageJson.version}
 * @license ${packageJson.license}
 * @author ${packageJson.author}
 * @link ${packageJson.homepage}
 */
`;
const createPlugins = () => [
  typescript({
    tsconfig: './tsconfig.build.json',
  }),
  terser({
    format: {
      comments: /@license|^!/u,
    },
  }),
];

const configurations: RollupOptions[] = [
  {
    input: inputPath,
    output: {
      file: 'dist/index.js',
      format: 'esm',
      banner,
    },
    plugins: createPlugins(),
  },
  {
    input: inputPath,
    output: {
      file: 'dist/index.cjs',
      format: 'cjs',
      banner,
      exports: 'named',
    },
    plugins: createPlugins(),
  },
];

export default configurations;
