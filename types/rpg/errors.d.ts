export type RpgDiceRollErrorCode = 'DICE_NOTATION_REQUIRED' | 'TOO_MANY_ROLLS' | 'TOO_MANY_DICE' | 'INVALID_NOTATION' | 'ROLL_EXECUTION_LIMIT' | 'UNSUPPORTED_NOTATION';
export interface RpgDiceRollErrorDetails {
    [key: string]: unknown;
}
export interface RpgDiceRollErrorOptions {
    code: RpgDiceRollErrorCode;
    input?: string;
    notation?: string;
    normalizedNotation?: string;
    limit?: number;
    details?: RpgDiceRollErrorDetails;
}
export declare class RpgDiceRollError extends Error {
    code: RpgDiceRollErrorCode;
    input?: string;
    notation?: string;
    normalizedNotation?: string;
    limit?: number;
    details: RpgDiceRollErrorDetails;
    constructor(message: string, options: RpgDiceRollErrorOptions);
}
