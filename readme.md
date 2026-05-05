# @erpg/dicecore

ERPG Dice Core is the platform-neutral dice resolution library used by ERPG projects.
It owns parsing, normalization, safety limits, deterministic replay, grouped rolls, and structured result data for UI, automation, chat, and 3D dice display layers.

It intentionally does not format Discord messages, embeds, ANSI output, skins, or chat-specific text.
Consumers decide presentation; this package resolves dice.

## Install

```bash
npm install @erpg/dicecore
```

For ERPG internal projects the package can also be consumed from Git:

```json
{
  "@erpg/dicecore": "git+https://github.com/arkanus-app/rpg-dice-roller.git"
}
```

## Main API

```ts
import {
  inspectRpgDiceNotation,
  normalizeRpgDiceNotation,
  rollRpgDice,
  verifyRpgDiceNotation,
} from '@erpg/dicecore';

const result = rollRpgDice('2#1d20+5', {
  maxDice: 9999,
  maxRolls: 100,
  seed: 'encounter-42',
});

console.log(result.total);
console.log(result.rolls);
console.log(result.dice);
console.log(result.events);

const inspection = inspectRpgDiceNotation('4d6kh3');
console.log(inspection.isValid, inspection.cost);
```

## ERPG notation helpers

The facade keeps common table-writing shortcuts ergonomic before handing the formula to the parser:

- `d` -> `d20`
- `2d` -> `2d20`
- `f` -> `4dF`
- `2f` -> `2dF`
- `df` -> `dF`
- `ei6` -> `!>=6`
- `km` -> `kl`
- `k`, `kh`, `kl` without number -> `k1`, `kh1`, `kl1`
- simple operator cleanup such as `+-`, `-+`, `++`, `--`
- `N#formula` for independent grouped rolls

Native math functions such as `floor(...)`, `ceil(...)`, `round(...)`, `min(...)`, and `max(...)` stay as parser notation, not facade options.

## Public helpers

- `rollRpgDice(input, options)`
- `inspectRpgDiceNotation(input, options)`
- `normalizeRpgDiceNotation(input)`
- `parseRpgDiceInput(input)`
- `extractRpgDiceGroups(input)`
- `countRpgDiceInNotation(input)`
- `verifyRpgDiceNotation(input, options)`

`options` currently supports:

- `maxDice?: number`
- `maxRolls?: number`
- `seed?: string | number`

## Result data

`rollRpgDice` returns structured data for repeated rolls, UI, and 3D display:

- `total`
- `rolls[]`
- `dice[]`
- `events[]`
- `notation`
- `normalizedNotation`
- `comment`

Each `dice[]` entry includes final value, initial value, calculation value, group metadata, modifier flags, and booleans for dropped, exploded, rerolled, critical success, and critical failure states.

## Attribution

This package is an ERPG-owned derivative of the open-source `@dice-roller/rpg-dice-roller` project by GreenImp.
The original parser and dice engine provided the foundation; ERPG has since added a proprietary facade, normalization layer, structured UI/3D output, deterministic seed support, execution safety checks, browser compatibility work, and an incremental TypeScript migration.

The original project remains credited in `licence.txt`.
This package keeps the MIT license and preserves the upstream copyright notice.

## License

MIT.
