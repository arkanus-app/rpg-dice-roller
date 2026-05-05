/**
 * An error thrown when a required argument is missing
 */
class RequiredArgumentError extends Error {
  argumentName: string | null;

  /**
   * Create a `RequiredArgumentError`
   *
   * @param {string|null} [argumentName=null] The argument name
   */
  constructor(argumentName: string | null = null) {
    super(`Missing argument${argumentName ? ` "${argumentName}"` : ''}`);

    const ErrorConstructor = Error as ErrorConstructor & {
      captureStackTrace?: (targetObject: object, constructorOpt?: object) => void;
    };

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (ErrorConstructor.captureStackTrace) {
      ErrorConstructor.captureStackTrace(this, RequiredArgumentError);
    }

    this.argumentName = argumentName;
  }
}

export default RequiredArgumentError;
