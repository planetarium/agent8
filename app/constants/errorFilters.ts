/**
 * Error filtering configuration for known non-issues
 *
 * This module defines known errors that are not service issues.
 * These errors are filtered to prevent unnecessary external notifications (e.g., Slack)
 * while providing user-friendly messages via toast notifications.
 *
 * Use cases:
 * - Development/testing errors
 * - Expected user actions (e.g., cancellation)
 * - Known client-side issues that don't require immediate attention
 */

/**
 * Configuration for filtering error messages
 */
export interface ErrorFilter {
  /** Pattern to match against error messages (string or RegExp) */
  pattern: string | RegExp;

  /** Optional reason for filtering this error (for documentation) */
  reason?: string;

  /** Case-sensitive matching for string patterns (default: false) */
  caseSensitive?: boolean;

  /** Optional replacement message to show to users instead of the original error */
  replacementMessage?: string;
}

/**
 * List of error messages that should not trigger external notifications
 *
 * Add patterns here to prevent specific errors from being sent to Slack
 * while still displaying them to users in the UI.
 */
export const ERROR_FILTERS: ErrorFilter[] = [
  {
    pattern: 'User location is not supported for the API use.',
    reason: 'Google Generative AI API error',
    caseSensitive: false,
    replacementMessage: 'The selected model is not available in your current location.',
  },
  {
    pattern: 'Insufficient credit',
    reason: 'Verse8 API error',
    caseSensitive: false,
    replacementMessage: "You don't have enough credit",
  },
];

/**
 * Get the error filter that matches the given error, if any
 *
 * @param error - Error object or error message string
 * @returns The matching ErrorFilter if found, null otherwise
 */
export function getErrorFilter(error?: Error | string): ErrorFilter | null {
  if (!error) {
    return null;
  }

  // Extract error message
  const errorMessage = error instanceof Error ? error.message : error;

  // Find matching filter
  return (
    ERROR_FILTERS.find((filter) => {
      if (filter.pattern instanceof RegExp) {
        // RegExp pattern matching
        return filter.pattern.test(errorMessage);
      } else {
        // String pattern matching
        const pattern = filter.caseSensitive ? filter.pattern : filter.pattern.toLowerCase();
        const message = filter.caseSensitive ? errorMessage : errorMessage.toLowerCase();

        return message.includes(pattern);
      }
    }) || null
  );
}
