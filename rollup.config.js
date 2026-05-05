import { readFileSync } from 'node:fs';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

const inputPath = 'src/index.ts';
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const banner = `/*!
 * ${packageJson.name} - ${packageJson.description}
 *
 * @version ${packageJson.version}
 * @license ${packageJson.license}
 * @author ${packageJson.author}
 * @link ${packageJson.homepage}
 */
`;
const globals = {
  mathjs: 'math',
  'random-js': 'Random',
};

const plugins = [
  nodeResolve(),
  typescript({
    tsconfig: './tsconfig.build.json',
  }),
  commonjs(),
];

export default [
  {
    input: inputPath,
    output: {
      file: 'lib/esm/index.js',
      format: 'esm',
      banner,
      globals,
    },
    plugins,
    external: ['mathjs'],
  },
  {
    input: inputPath,
    output: {
      file: 'lib/cjs/index.cjs',
      format: 'cjs',
      banner,
      exports: 'named',
      globals,
    },
    plugins,
    external: ['mathjs'],
  },
];
