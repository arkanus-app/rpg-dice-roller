/**
 * Check if the value is a valid base64 encoded string.
 *
 * @param {string} val
 *
 * @returns {boolean} `true` if it is valid base64 encoded, `false` otherwise
 */
declare const isBase64: (val: string) => boolean;
/**
 * Check if the value is a valid JSON encoded string.
 *
 * @param {string} val
 *
 * @returns {boolean} `true` if the value is valid JSON, `false` otherwise
 */
declare const isJson: (val: string) => boolean;
export { isBase64, isJson, };
