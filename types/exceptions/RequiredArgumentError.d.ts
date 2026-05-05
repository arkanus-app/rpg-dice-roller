/**
 * An error thrown when a required argument is missing
 */
declare class RequiredArgumentError extends Error {
    argumentName: string | null;
    /**
     * Create a `RequiredArgumentError`
     *
     * @param {string|null} [argumentName=null] The argument name
     */
    constructor(argumentName?: string | null);
}
export default RequiredArgumentError;
