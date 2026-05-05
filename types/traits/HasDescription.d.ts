import Description from '../Description.js';
declare const descriptionSymbol: unique symbol;
export interface HasDescriptionJSON {
    description: Description | null;
}
/**
 * A base class for description functionality.
 *
 * @abstract
 */
declare class HasDescription {
    private [descriptionSymbol];
    constructor(text?: unknown);
    /**
     * The description for the group.
     *
     * @return {Description|null}
     */
    get description(): Description | null;
    /**
     * Set the description on the group.
     *
     * @param {Description|string|null} description
     */
    set description(description: unknown);
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @returns {{description: (Description|null)}}
     */
    toJSON(): HasDescriptionJSON;
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
export default HasDescription;
