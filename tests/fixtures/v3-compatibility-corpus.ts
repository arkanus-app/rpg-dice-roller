export interface CompatibilitySeed {
  readonly name: string;
  readonly words: readonly number[];
}

export interface CompatibilityPoolGolden {
  readonly successes: number;
  readonly failures: number;
  readonly netSuccesses: number;
}

export interface CompatibilityRollGolden {
  readonly total: number;
  readonly rollTotals: readonly number[];
  readonly diceValuesByRoll: readonly (readonly number[])[];
  readonly pool: CompatibilityPoolGolden | null;
}

export interface CompatibilityCorpusEntry {
  readonly notation: string;
  readonly normalizedNotation: string;
  readonly outcomes: readonly CompatibilityRollGolden[];
}

export const compatibilitySeeds: readonly CompatibilitySeed[] = [
  { name: 'low-words', words: [1, 2, 3, 4] },
  { name: 'wide-words', words: [0xdead_beef, 0xcafe_babe, 42, 0xffff_ffff] },
];

export const compatibilityCorpus: readonly CompatibilityCorpusEntry[] = [
  {
    notation: 'd + 2d + f',
    normalizedNotation: 'd20+2d20+4dF',
    outcomes: [
      { total: 36, rollTotals: [36], diceValuesByRoll: [[-1, -1, 0, 0, 3, 15, 20]], pool: null },
      { total: 32, rollTotals: [32], diceValuesByRoll: [[0, 0, 0, 1, 4, 9, 18]], pool: null },
    ],
  },
  {
    notation: '2d6+3',
    normalizedNotation: '2d6+3',
    outcomes: [
      { total: 10, rollTotals: [10], diceValuesByRoll: [[1, 6]], pool: null },
      { total: 9, rollTotals: [9], diceValuesByRoll: [[2, 4]], pool: null },
    ],
  },
  {
    notation: '2#2d6+1',
    normalizedNotation: '2#2d6+1',
    outcomes: [
      { total: 14, rollTotals: [8, 6], diceValuesByRoll: [[1, 6], [1, 4]], pool: null },
      { total: 18, rollTotals: [7, 11], diceValuesByRoll: [[2, 4], [5, 5]], pool: null },
    ],
  },
  {
    notation: 'd%',
    normalizedNotation: 'd%',
    outcomes: [
      { total: 35, rollTotals: [35], diceValuesByRoll: [[35]], pool: null },
      { total: 38, rollTotals: [38], diceValuesByRoll: [[38]], pool: null },
    ],
  },
  {
    notation: '2dF.1+2dF.2',
    normalizedNotation: '2dF.1+2dF.2',
    outcomes: [
      { total: -2, rollTotals: [-2], diceValuesByRoll: [[-1, -1, -1, 1]], pool: null },
      { total: 0, rollTotals: [0], diceValuesByRoll: [[0, 0, 0, 0]], pool: null },
    ],
  },
  {
    notation: '4d6kh3',
    normalizedNotation: '4d6kh3',
    outcomes: [
      { total: 11, rollTotals: [11], diceValuesByRoll: [[1, 1, 4, 6]], pool: null },
      { total: 14, rollTotals: [14], diceValuesByRoll: [[2, 4, 5, 5]], pool: null },
    ],
  },
  {
    notation: '4d6dl1',
    normalizedNotation: '4d6dl1',
    outcomes: [
      { total: 11, rollTotals: [11], diceValuesByRoll: [[1, 1, 4, 6]], pool: null },
      { total: 14, rollTotals: [14], diceValuesByRoll: [[2, 4, 5, 5]], pool: null },
    ],
  },
  {
    notation: '3d6min3max5',
    normalizedNotation: '3d6min3max5',
    outcomes: [
      { total: 11, rollTotals: [11], diceValuesByRoll: [[3, 3, 5]], pool: null },
      { total: 12, rollTotals: [12], diceValuesByRoll: [[3, 4, 5]], pool: null },
    ],
  },
  {
    notation: '2d6cs=6cf=1',
    normalizedNotation: '2d6cs=6cf=1',
    outcomes: [
      { total: 7, rollTotals: [7], diceValuesByRoll: [[1, 6]], pool: null },
      { total: 6, rollTotals: [6], diceValuesByRoll: [[2, 4]], pool: null },
    ],
  },
  {
    notation: '4d6sa',
    normalizedNotation: '4d6sa',
    outcomes: [
      { total: 12, rollTotals: [12], diceValuesByRoll: [[1, 1, 4, 6]], pool: null },
      { total: 16, rollTotals: [16], diceValuesByRoll: [[2, 4, 5, 5]], pool: null },
    ],
  },
  {
    notation: '5d10>=8f=1',
    normalizedNotation: '5d10>=8f=1',
    outcomes: [
      {
        total: 2,
        rollTotals: [2],
        diceValuesByRoll: [[3, 3, 5, 10, 10]],
        pool: { successes: 2, failures: 0, netSuccesses: 2 },
      },
      {
        total: 2,
        rollTotals: [2],
        diceValuesByRoll: [[3, 4, 7, 8, 9]],
        pool: { successes: 2, failures: 0, netSuccesses: 2 },
      },
    ],
  },
  {
    notation: '{1d6,1d8}kh1',
    normalizedNotation: '{1d6,1d8}kh1',
    outcomes: [
      { total: 8, rollTotals: [8], diceValuesByRoll: [[1, 8]], pool: null },
      { total: 4, rollTotals: [4], diceValuesByRoll: [[4, 4]], pool: null },
    ],
  },
  {
    notation: 'ceil(1d6/2)+pow(2,3)',
    normalizedNotation: 'ceil(1d6/2)+pow(2,3)',
    outcomes: [
      { total: 9, rollTotals: [9], diceValuesByRoll: [[1]], pool: null },
      { total: 10, rollTotals: [10], diceValuesByRoll: [[4]], pool: null },
    ],
  },
  {
    notation: '(2d6+1)*2',
    normalizedNotation: '(2d6+1)*2',
    outcomes: [
      { total: 16, rollTotals: [16], diceValuesByRoll: [[1, 6]], pool: null },
      { total: 14, rollTotals: [14], diceValuesByRoll: [[2, 4]], pool: null },
    ],
  },
  {
    notation: '1d6!=1',
    normalizedNotation: '1d6!=1',
    outcomes: [
      { total: 7, rollTotals: [7], diceValuesByRoll: [[1, 6]], pool: null },
      { total: 4, rollTotals: [4], diceValuesByRoll: [[4]], pool: null },
    ],
  },
  {
    notation: '2d6r<3',
    normalizedNotation: '2d6r<3',
    outcomes: [
      { total: 10, rollTotals: [10], diceValuesByRoll: [[4, 6]], pool: null },
      { total: 9, rollTotals: [9], diceValuesByRoll: [[4, 5]], pool: null },
    ],
  },
  {
    notation: '4d6u',
    normalizedNotation: '4d6u',
    outcomes: [
      { total: 16, rollTotals: [16], diceValuesByRoll: [[1, 4, 5, 6]], pool: null },
      { total: 14, rollTotals: [14], diceValuesByRoll: [[2, 3, 4, 5]], pool: null },
    ],
  },
  {
    notation: '2d6ei6',
    normalizedNotation: '2d6!>=6',
    outcomes: [
      { total: 8, rollTotals: [8], diceValuesByRoll: [[1, 1, 6]], pool: null },
      { total: 6, rollTotals: [6], diceValuesByRoll: [[2, 4]], pool: null },
    ],
  },
  {
    notation: '4d6km',
    normalizedNotation: '4d6kl1',
    outcomes: [
      { total: 1, rollTotals: [1], diceValuesByRoll: [[1, 1, 4, 6]], pool: null },
      { total: 2, rollTotals: [2], diceValuesByRoll: [[2, 4, 5, 5]], pool: null },
    ],
  },
  {
    notation: '3d6kh2+2',
    normalizedNotation: '3d6kh2+2',
    outcomes: [
      { total: 9, rollTotals: [9], diceValuesByRoll: [[1, 1, 6]], pool: null },
      { total: 11, rollTotals: [11], diceValuesByRoll: [[2, 4, 5]], pool: null },
    ],
  },
  {
    notation: '3d6dh1',
    normalizedNotation: '3d6dh1',
    outcomes: [
      { total: 2, rollTotals: [2], diceValuesByRoll: [[1, 1, 6]], pool: null },
      { total: 6, rollTotals: [6], diceValuesByRoll: [[2, 4, 5]], pool: null },
    ],
  },
  {
    notation: '6d10>=7f=1',
    normalizedNotation: '6d10>=7f=1',
    outcomes: [
      {
        total: 2,
        rollTotals: [2],
        diceValuesByRoll: [[3, 3, 4, 5, 10, 10]],
        pool: { successes: 2, failures: 0, netSuccesses: 2 },
      },
      {
        total: 3,
        rollTotals: [3],
        diceValuesByRoll: [[3, 4, 4, 7, 8, 9]],
        pool: { successes: 3, failures: 0, netSuccesses: 3 },
      },
    ],
  },
  {
    notation: 'abs(1d6-6)+floor(1d8/3)',
    normalizedNotation: 'abs(1d6-6)+floor(1d8/3)',
    outcomes: [
      { total: 7, rollTotals: [7], diceValuesByRoll: [[1, 8]], pool: null },
      { total: 3, rollTotals: [3], diceValuesByRoll: [[4, 4]], pool: null },
    ],
  },
  {
    notation: '{1d4+1,1d6+2}dl1',
    normalizedNotation: '{1d4+1,1d6+2}dl1',
    outcomes: [
      { total: 8, rollTotals: [8], diceValuesByRoll: [[3, 6]], pool: null },
      { total: 4, rollTotals: [4], diceValuesByRoll: [[2, 2]], pool: null },
    ],
  },
  {
    notation: '3#1d20+5',
    normalizedNotation: '3#1d20+5',
    outcomes: [
      { total: 53, rollTotals: [20, 25, 8], diceValuesByRoll: [[15], [20], [3]], pool: null },
      { total: 46, rollTotals: [23, 9, 14], diceValuesByRoll: [[18], [4], [9]], pool: null },
    ],
  },
  {
    notation: '2d6ro<3',
    normalizedNotation: '2d6ro<3',
    outcomes: [
      { total: 7, rollTotals: [7], diceValuesByRoll: [[1, 6]], pool: null },
      { total: 9, rollTotals: [9], diceValuesByRoll: [[4, 5]], pool: null },
    ],
  },
  {
    notation: '2d6!p=6',
    normalizedNotation: '2d6!p=6',
    outcomes: [
      { total: 7, rollTotals: [7], diceValuesByRoll: [[0, 1, 6]], pool: null },
      { total: 6, rollTotals: [6], diceValuesByRoll: [[2, 4]], pool: null },
    ],
  },
  {
    notation: '2d6!>=5',
    normalizedNotation: '2d6!>=5',
    outcomes: [
      { total: 8, rollTotals: [8], diceValuesByRoll: [[1, 1, 6]], pool: null },
      { total: 6, rollTotals: [6], diceValuesByRoll: [[2, 4]], pool: null },
    ],
  },
  {
    notation: '2d8sd',
    normalizedNotation: '2d8sd',
    outcomes: [
      { total: 11, rollTotals: [11], diceValuesByRoll: [[3, 8]], pool: null },
      { total: 10, rollTotals: [10], diceValuesByRoll: [[4, 6]], pool: null },
    ],
  },
  {
    notation: 'sqrt(1d100)',
    normalizedNotation: 'sqrt(1d100)',
    outcomes: [
      { total: 5.92, rollTotals: [5.92], diceValuesByRoll: [[35]], pool: null },
      { total: 6.16, rollTotals: [6.16], diceValuesByRoll: [[38]], pool: null },
    ],
  },
  {
    notation: '2d%kh1',
    normalizedNotation: '2d%kh1',
    outcomes: [
      { total: 80, rollTotals: [80], diceValuesByRoll: [[35, 80]], pool: null },
      { total: 64, rollTotals: [64], diceValuesByRoll: [[38, 64]], pool: null },
    ],
  },
];
