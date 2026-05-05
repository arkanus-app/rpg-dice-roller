declare const textSymbol: unique symbol;
declare const typeSymbol: unique symbol;
declare const descriptionTypes: Readonly<{
    MULTILINE: "multiline";
    INLINE: "inline";
}>;
export type DescriptionType = (typeof descriptionTypes)[keyof typeof descriptionTypes];
export interface DescriptionJSON {
    text: string;
    type: string;
}
/**
 * Represents a Roll / Roll group description.
 */
declare class Description {
    static types: Readonly<{
        MULTILINE: "multiline";
        INLINE: "inline";
    }>;
    private [textSymbol];
    private [typeSymbol];
    /**
     * Create a `Description` instance.
     *
     * @param {string} text
     * @param {string} [type=inline]
     */
    constructor(text: string | number, type?: string);
    /**
     * The description text.
     *
     * @return {string}
     */
    get text(): string;
    /**
     * Set the description text.
     *
     * @param {string|number} text
     */
    set text(text: string | number);
    /**
     * The description type.
     *
     * @return {string} "inline" or "multiline"
     */
    get type(): string;
    /**
     * Set the description type.
     *
     * @param {string} type
     */
    set type(type: string);
    /**
     * Return an object for JSON serialising.
     *
     * This is called automatically when JSON encoding the object.
     *
     * @return {{text: string, type: string}}
     */
    toJSON(): DescriptionJSON;
    /**
     * Return the String representation of the object.
     *
     * This is called automatically when casting the object to a string.
     *
     * @see {@link Description#text}
     *
     * @returns {string}
     */
    toString(): string;
}
export default Description;
