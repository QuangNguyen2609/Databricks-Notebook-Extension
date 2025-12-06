/**
 * Error Handling Utilities
 *
 * Provides consistent error message extraction and formatting
 * across the codebase.
 */

/**
 * Extract a readable error message from any thrown value.
 * Handles Error objects, strings, and other types consistently.
 *
 * @param error - The caught error/exception
 * @returns A string error message
 *
 * @example
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   console.error('Operation failed:', extractErrorMessage(error));
 * }
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error === null) {
    return 'null error';
  }
  if (error === undefined) {
    return 'undefined error';
  }
  return String(error);
}

/**
 * Create an Error object from any thrown value.
 * Useful when you need to re-throw or wrap errors consistently.
 *
 * @param error - The caught error/exception
 * @returns An Error object
 *
 * @example
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   throw toError(error);
 * }
 */
export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(extractErrorMessage(error));
}

/**
 * Log an error with consistent formatting.
 *
 * @param context - A context string describing where the error occurred
 * @param error - The caught error/exception
 */
export function logError(context: string, error: unknown): void {
  console.error(`[${context}]`, extractErrorMessage(error));
}

/**
 * Log a debug message with consistent formatting.
 *
 * @param context - A context string describing the source
 * @param message - The debug message
 */
export function logDebug(context: string, message: string): void {
  console.debug(`[${context}] ${message}`);
}
