import Modifier from './Modifier.js';
/**
 * Return the flags for the given list of modifiers
 *
 * @param {...Modifier|string} modifiers
 *
 * @returns {string}
 */
declare const getModifierFlags: (...modifiers: Array<Modifier | string>) => string;
export default getModifierFlags;
