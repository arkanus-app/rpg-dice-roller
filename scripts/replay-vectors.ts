export type ReplayAlgorithm = 'mt19937' | 'xoshiro128ss';

export interface CrossRuntimeReplayVector {
  readonly input: string;
  readonly name: string;
  readonly options: {
    readonly randomAlgorithm: ReplayAlgorithm;
    readonly seed: string;
  };
}

export const crossRuntimeReplayVectors: readonly CrossRuntimeReplayVector[] = [
  {
    input: '2#4d6kh3+1d8',
    name: 'mt19937-multi-modifiers',
    options: {
      randomAlgorithm: 'mt19937',
      seed: 'cross-runtime-v3/mt19937',
    },
  },
  {
    input: '2#4d6kh3+1d8',
    name: 'xoshiro128ss-multi-modifiers',
    options: {
      randomAlgorithm: 'xoshiro128ss',
      seed: 'cross-runtime-v3/xoshiro128ss',
    },
  },
  {
    input: '2#sqrt(1d100)+sin(1d6)',
    name: 'mt19937-decimal12-math',
    options: {
      randomAlgorithm: 'mt19937',
      seed: 'cross-runtime-v3/decimal12-math',
    },
  },
];
