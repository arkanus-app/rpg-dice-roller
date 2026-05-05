import type RollResult from '../results/RollResult.js';
import type RollResults from '../results/RollResults.js';
import type ResultGroup from '../results/ResultGroup.js';

export type ModifierContext = {
  min: number;
  max: number;
  rollOnce: () => RollResult;
};

export type ModifierDefaults = Record<string, unknown>;

export type ModifierResult = RollResults | ResultGroup;

export type RollLike = {
  value: number;
  calculationValue: number;
  modifiers: Set<string>;
  useInTotal: boolean;
};

export type RollIndexEntry = {
  value: number;
  index: number | [number, number];
};
