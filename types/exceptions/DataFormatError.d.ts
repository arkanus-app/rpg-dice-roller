/**
 * An error thrown when a data format is invalid
 */
declare class DataFormatError extends Error {
    data: unknown;
    /**
     * Create a `DataFormatError`
     *
     * @param {*} data The invalid data
     */
    constructor(data: unknown);
}
export default DataFormatError;
