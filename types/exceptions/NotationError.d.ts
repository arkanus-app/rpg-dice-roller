/**
 * An error thrown when the notation is invalid
 */
declare class NotationError extends Error {
    notation: unknown;
    /**
     * Create a `NotationError`
     *
     * @param {*} notation The invalid notation
     */
    constructor(notation: unknown);
}
export default NotationError;
