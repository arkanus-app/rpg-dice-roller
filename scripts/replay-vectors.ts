export type ReplayAlgorithm = 'mt19937' | 'xoshiro128ss';

export interface CrossRuntimeReplayVector {
  readonly input: string;
  readonly kind: 'generic' | 'mixed';
  readonly name: string;
  readonly options: {
    readonly randomAlgorithm: ReplayAlgorithm;
    readonly seed: string;
  };
}

export const crossRuntimeReplayVectors: readonly CrossRuntimeReplayVector[] = [
  {
    input: '2#4d6kh3+1d8',
    kind: 'generic',
    name: 'mt19937-multi-modifiers',
    options: {
      randomAlgorithm: 'mt19937',
      seed: 'cross-runtime-v3/mt19937',
    },
  },
  {
    input: '2#4d6kh3+1d8',
    kind: 'generic',
    name: 'xoshiro128ss-multi-modifiers',
    options: {
      randomAlgorithm: 'xoshiro128ss',
      seed: 'cross-runtime-v3/xoshiro128ss',
    },
  },
  {
    input: '2#sqrt(1d100)+sin(1d6)',
    kind: 'generic',
    name: 'mt19937-decimal12-math',
    options: {
      randomAlgorithm: 'mt19937',
      seed: 'cross-runtime-v3/decimal12-math',
    },
  },
  {
    input: '2d20kh1; fate(4); v5(7,3,4); assim(d6=2,d10=1,d12=1,keep=1); dh(2,15)',
    kind: 'mixed',
    name: 'mt19937-all-system-adapters',
    options: {
      randomAlgorithm: 'mt19937',
      seed: 'cross-runtime-v3/systems-mt19937',
    },
  },
  {
    input: '2d20kh1; fate(4); v5(7,3,4); assim(d6=2,d10=1,d12=1,keep=1); dh(2,15)',
    kind: 'mixed',
    name: 'xoshiro128ss-all-system-adapters',
    options: {
      randomAlgorithm: 'xoshiro128ss',
      seed: 'cross-runtime-v3/systems-xoshiro128ss',
    },
  },
];
