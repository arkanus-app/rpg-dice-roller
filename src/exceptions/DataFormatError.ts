/**
 * An error thrown when a data format is invalid
 */
class DataFormatError extends Error {
  data: unknown;

  /**
   * Create a `DataFormatError`
   *
   * @param {*} data The invalid data
   */
  constructor(data: unknown) {
    super(`Invalid data format: ${data}`);

    const ErrorConstructor = Error as ErrorConstructor & {
      captureStackTrace?: (targetObject: object, constructorOpt?: object) => void;
    };

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (ErrorConstructor.captureStackTrace) {
      ErrorConstructor.captureStackTrace(this, DataFormatError);
    }

    this.name = 'ImportError';

    this.data = data;
  }
}

export default DataFormatError;
