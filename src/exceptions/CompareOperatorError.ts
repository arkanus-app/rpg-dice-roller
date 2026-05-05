/**
 * An error thrown when a comparison operator is invalid
 */
class CompareOperatorError extends TypeError {
  operator: unknown;

  /**
   * Create a `CompareOperatorError`
   *
   * @param {*} operator The invalid operator
   */
  constructor(operator: unknown) {
    super(`Operator "${operator}" is invalid`);

    const ErrorConstructor = TypeError as ErrorConstructor & {
      captureStackTrace?: (targetObject: object, constructorOpt?: object) => void;
    };

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (ErrorConstructor.captureStackTrace) {
      ErrorConstructor.captureStackTrace(this, CompareOperatorError);
    }

    this.name = 'CompareOperatorError';

    this.operator = operator;
  }
}

export default CompareOperatorError;
