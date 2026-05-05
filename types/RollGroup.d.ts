import HasDescription from './traits/HasDescription.js';
import Modifier from './modifiers/Modifier.js';
import ResultGroup from './results/ResultGroup.js';
import StandardDice from './dice/StandardDice.js';
import type Description from './Description.js';
declare const expressionsSymbol: unique symbol;
declare const modifiersSymbol: unique symbol;
export type RollGroupExpressionItem = StandardDice | string | number;
export type RollGroupExpression = RollGroupExpressionItem[];
export type RollGroupModifierMap = Map<string, Modifier>;
export type RollGroupModifierInput = RollGroupModifierMap | Modifier[] | Record<string, Modifier> | null;
export interface RollGroupJson {
    description: Description | null;
    expressions: RollGroupExpression[];
    modifiers: RollGroupModifierMap | null;
    notation: string;
    type: 'group';
}
/**
 * A `RollGroup` is a group of one or more "sub-rolls".
 *
 * A sub-roll is just simple roll notation (e.g. `4d6`, `2d10*3`, `5/10d20`)
 *
 * @example <caption>`{4d6+4, 2d%/5}k1`</caption>
 * const expressions = [
 *   [
 *     new StandardDice(6, 4),
 *     '+',
 *     4,
 *   ],
 *   [
 *     new PercentileDice(2),
 *     '/',
 *     5,
 *   ],
 * ];
 *
 * const modifiers = [
 *   new KeepModifier(),
 * ];
 *
 * const group = new RollGroup(expressions, modifiers);
 *
 * @since 4.5.0
 */
declare class RollGroup extends HasDescription {
    private [expressionsSymbol];
    private [modifiersSymbol];
    /**
     * Create a `RollGroup` instance.
     *
     * @param {Array.<Array.<StandardDice|string|number>>} [expressions=[]] List of sub-rolls
     * @param {Map<string, Modifier>|Modifier[]|{}|null} [modifiers=[]] The modifiers that affect the
     * group
     * @param {Description|string|null} [description=null] The roll description.
     */
    constructor(expressions?: RollGroupExpression[], modifiers?: RollGroupModifierInput, description?: unknown);
    /**
     * The sub-roll expressions in the group.
     *
     * @returns {Array.<Array.<StandardDice|string|number>>}
     */
    get expressions(): RollGroupExpression[];
    /**
     * Set the sub-roll expressions in the group.
     *
     * @param {Array.<Array.<StandardDice|string|number>>} expressions
     *
     * @throws {TypeError} Expressions must be an array of arrays
     * @throws {TypeError} Sub expressions cannot be empty
     * @throws {TypeError} Sub expression items must be Dice, numbers, or strings
     */
    set expressions(expressions: RollGroupExpression[]);
    /**
     * The modifiers that affect the object.
     *
     * @returns {Map<string, Modifier>|null}
     */
    get modifiers(): RollGroupModifierMap | null;
    /**
     * Set the modifiers that affect this group.
     *
     * @param {Map<string, Modifier>|Modifier[]|{}|null} value
     *
     * @throws {TypeError} Modifiers should be a Map, array of Modifiers, or an Object
     */
    set modifiers(value: RollGroupModifierInput);
    /**
     * The group notation. e.g. `{4d6, 2d10+3}k1`.
     *
     * @returns {string}
     */
    get notation(): string;
    /**
     * Run the sub-roll expressions for the group.
     *
     * @example <caption>`{4d6+4/1d6, 2d10/3}k1`</caption>
     * ResultGroup {
     *   results: [
     *     // sub-roll 1 - 4d6+4/1d6
     *     ResultGroup {
     *       results: [
     *         RollResults {
     *           rolls: [
     *             RollResult {
     *               value: 2
     *             },
     *             RollResult {
     *               value: 5
     *             },
     *             RollResult {
     *               value: 4
     *             },
     *             RollResult {
     *               value: 1
     *             }
     *           ]
     *         },
     *         '+',
     *         4,
     *         '/',
     *         RollResults {
     *           rolls: [
     *             RollResult {
     *               value: 4
     *             }
     *           ]
     *         }
     *       ]
     *     },
     *     // sub-roll 2 - 2d10/3
     *     ResultGroup {
     *       results: [
     *         RollResults {
     *           rolls: [
     *             RollResults {
     *               4
     *             },
     *             RollResults {
     *               9
     *             }
     *           ]
     *         },
     *         '/',
     *         3
     *       ]
     *     }
     *   ]
     * }
     *
     * @returns {ResultGroup} The results of the sub-rolls
     */
    roll(): ResultGroup;
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{
     *  notation: string,
     *  modifiers: (Map<string, Modifier>|null),
     *  type: string,
     *  expressions: Array.<Array.<StandardDice|string|number>>
     * }}
     */
    toJSON(): RollGroupJson;
    /**
     * Return the String representation of the object.
     *
     * This is called automatically when casting the object to a string.
     *
     * @see {@link RollGroup#notation}
     *
     * @returns {string}
     */
    toString(): string;
}
export default RollGroup;
