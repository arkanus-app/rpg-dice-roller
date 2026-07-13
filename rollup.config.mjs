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

const configurations = [
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
