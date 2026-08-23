import { readFileSync } from 'node:fs';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
);

const requiredMetadata = [
  'author',
  'description',
  'homepage',
  'license',
  'name',
  'version',
];

if (
  typeof packageJson !== 'object'
  || packageJson === null
  || requiredMetadata.some((key) => typeof packageJson[key] !== 'string')
) {
  throw new TypeError('package.json has invalid package metadata');
}

const input = {
  index: 'src/index.ts',
  core: 'src/v3/core.ts',
  'systems/index': 'src/v3/systems/index.ts',
  'systems/assimilation': 'src/v3/systems/assimilation.ts',
  'systems/daggerheart': 'src/v3/systems/daggerheart.ts',
  'systems/fate': 'src/v3/systems/fate.ts',
  'systems/mixed': 'src/v3/systems/mixed.ts',
  'systems/vampire-v5': 'src/v3/systems/vampire-v5.ts',
};
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
    compress: {
      passes: 2,
    },
    format: {
      comments: /@license|^!/u,
    },
  }),
];

const configurations = [
  {
    input,
    output: {
      dir: 'dist',
      entryFileNames: '[name].js',
      chunkFileNames: 'chunks/[name]-[hash].js',
      format: 'esm',
      banner,
    },
    plugins: createPlugins(),
  },
  {
    input,
    output: {
      dir: 'dist',
      entryFileNames: '[name].cjs',
      chunkFileNames: 'chunks/[name]-[hash].cjs',
      format: 'cjs',
      banner,
      exports: 'named',
    },
    plugins: createPlugins(),
  },
];

export default configurations;
