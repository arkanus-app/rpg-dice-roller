import {
  compatibilityCorpus,
  compatibilitySeeds,
  type CompatibilityRollGolden,
} from './v3-compatibility-corpus.js';
import {
  normalizeRpgDiceNotation,
  rollRpgDice,
  type RpgDiceRollResult,
} from '../../src/RpgDiceRoll.js';
import { engines, generator } from '../../src/utilities/NumberGenerator.js';

function projectResult(result: RpgDiceRollResult): CompatibilityRollGolden {
  const pool = result.pool.hasTarget
    ? {
        successes: result.pool.successes,
        failures: result.pool.failures,
        netSuccesses: result.pool.netSuccesses,
      }
    : null;

  return {
    total: result.total,
    rollTotals: result.rolls.map((roll) => roll.total),
    diceValuesByRoll: result.rolls.map((roll) => (
      roll.dice.map((die) => die.value).sort((left, right) => left - right)
    )),
    pool,
  };
}

const initialEngine = generator.engine;

try {
  const results = compatibilityCorpus.flatMap((entry) => (
    compatibilitySeeds.map((seed) => {
      generator.engine = engines.MersenneTwister19937.seedWithArray([...seed.words]);
      return {
        caseName: `${entry.notation} / ${seed.name}`,
        normalizedNotation: normalizeRpgDiceNotation(entry.notation),
        result: projectResult(rollRpgDice(entry.notation)),
      };
    })
  ));

  process.stdout.write(JSON.stringify(results));
} finally {
  generator.engine = initialEngine;
}
