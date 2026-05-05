/**
 * An error thrown when the notation is invalid
 */
class NotationError extends Error {
  notation: unknown;

  /**
   * Create a `NotationError`
   *
   * @param {*} notation The invalid notation
   */
  constructor(notation: unknown) {
    super(`Notation "${notation}" is invalid`);

    const ErrorConstructor = Error as ErrorConstructor & {
      captureStackTrace?: (targetObject: object, constructorOpt?: object) => void;
    };

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (ErrorConstructor.captureStackTrace) {
      ErrorConstructor.captureStackTrace(this, NotationError);
    }

    this.name = 'NotationError';

    this.notation = notation;
  }
}

export default NotationError;
