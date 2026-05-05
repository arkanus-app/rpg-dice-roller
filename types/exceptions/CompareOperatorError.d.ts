/**
 * An error thrown when a comparison operator is invalid
 */
declare class CompareOperatorError extends TypeError {
    operator: unknown;
    /**
     * Create a `CompareOperatorError`
     *
     * @param {*} operator The invalid operator
     */
    constructor(operator: unknown);
}
export default CompareOperatorError;
